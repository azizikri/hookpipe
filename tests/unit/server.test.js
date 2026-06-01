import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('../../src/db/queries.js', () => ({
  insertDelivery: vi.fn(),
  incrementStat: vi.fn(),
}));

vi.mock('ulid', () => ({
  ulid: vi.fn(() => 'delivery_01'),
}));

const { insertDelivery, incrementStat } = await import('../../src/db/queries.js');
const { createServer } = await import('../../src/server.js');

const makePipeline = (overrides = {}) => ({
  id: 'pipe_01',
  destinations: [{ id: 'dest_01', type: 'http' }],
  retry: { maxAttempts: 3 },
  ...overrides,
});

const makeDeps = ({ pipeline = makePipeline(), filter, transform } = {}) => {
  const deps = {
    pipelineLoader: {
      get: vi.fn(() => pipeline),
    },
    pluginLoader: {
      loadFilter: vi.fn(() => filter),
      loadTransform: vi.fn(() => transform),
    },
    queue: {
      enqueue: vi.fn(async (job) => ({ id: 'job_01', ...job })),
    },
    db: { name: 'db' },
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    config: {},
  };
  return deps;
};

const injectJson = (server, payload, headers = {}) => server.inject({
  method: 'POST',
  url: '/hook/pipe_01',
  headers: { 'content-type': 'application/json', ...headers },
  payload: JSON.stringify(payload),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createServer', () => {
  it('accepts a valid webhook, inserts a delivery, and enqueues destination jobs', async () => {
    const deps = makeDeps();
    const server = createServer(deps);

    const response = await injectJson(server, { event: 'created' }, { 'x-source': 'github' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'accepted', deliveryId: 'delivery_01' });
    expect(deps.pipelineLoader.get).toHaveBeenCalledWith('pipe_01');
    expect(insertDelivery).toHaveBeenCalledWith(deps.db, expect.objectContaining({
      id: 'delivery_01',
      pipelineId: 'pipe_01',
      payload: { event: 'created' },
      status: 'queued',
    }));
    expect(deps.queue.enqueue).toHaveBeenCalledWith({
      deliveryId: 'delivery_01',
      destinationId: 'dest_01',
      pipelineId: 'pipe_01',
      payload: { event: 'created' },
      headers: expect.objectContaining({ 'x-source': 'github' }),
      maxAttempts: 3,
    });
    expect(incrementStat).toHaveBeenCalledWith(deps.db, 'pipe_01', 'total_received');
  });

  it('returns 404 for an unknown pipeline', async () => {
    const deps = makeDeps({ pipeline: null });
    const server = createServer(deps);

    const response = await injectJson(server, { event: 'created' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Pipeline not found' });
    expect(insertDelivery).not.toHaveBeenCalled();
    expect(deps.queue.enqueue).not.toHaveBeenCalled();
  });

  it('returns 401 when HMAC authentication fails', async () => {
    const pipeline = makePipeline({
      auth: { type: 'hmac-sha256', header: 'x-hook-signature', secret: 'secret' },
    });
    const deps = makeDeps({ pipeline });
    const server = createServer(deps);

    const response = await injectJson(server, { event: 'created' }, { 'x-hook-signature': 'sha256=bad' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Authentication failed', details: 'Invalid signature' });
    expect(insertDelivery).not.toHaveBeenCalled();
    expect(deps.queue.enqueue).not.toHaveBeenCalled();
  });

  it('returns filtered and increments filtered stats when a filter drops the webhook', async () => {
    const filter = vi.fn(async () => ({ pass: false, reason: 'ignored event' }));
    const pipeline = makePipeline({ filter: { path: './filters/events.js', config: { allow: ['push'] } } });
    const deps = makeDeps({ pipeline, filter });
    const server = createServer(deps);

    const response = await injectJson(server, { event: 'ping' }, { 'x-hook': '1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'filtered', reason: 'ignored event' });
    expect(deps.pluginLoader.loadFilter).toHaveBeenCalledWith('./filters/events.js');
    expect(filter).toHaveBeenCalledWith({ event: 'ping' }, expect.objectContaining({ 'x-hook': '1' }), { allow: ['push'] });
    expect(incrementStat).toHaveBeenCalledWith(deps.db, 'pipe_01', 'total_filtered');
    expect(insertDelivery).not.toHaveBeenCalled();
    expect(deps.queue.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues the transformed payload when a transform modifies the webhook', async () => {
    const transform = vi.fn(async () => ({ normalized: true, event: 'created' }));
    const pipeline = makePipeline({ transform: { path: './transforms/normalize.js', config: { version: 1 } } });
    const deps = makeDeps({ pipeline, transform });
    const server = createServer(deps);

    const response = await injectJson(server, { action: 'created' });

    expect(response.statusCode).toBe(200);
    expect(deps.pluginLoader.loadTransform).toHaveBeenCalledWith('./transforms/normalize.js');
    expect(transform).toHaveBeenCalledWith({ action: 'created' }, expect.any(Object), { version: 1 });
    expect(insertDelivery).toHaveBeenCalledWith(deps.db, expect.objectContaining({
      payload: { normalized: true, event: 'created' },
    }));
    expect(deps.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      payload: { normalized: true, event: 'created' },
    }));
  });

  it('accepts a webhook with valid HMAC authentication', async () => {
    const payload = { event: 'created' };
    const rawPayload = JSON.stringify(payload);
    const signature = 'sha256=' + createHmac('sha256', 'secret').update(rawPayload).digest('hex');
    const pipeline = makePipeline({
      auth: { type: 'hmac-sha256', header: 'x-hook-signature', secret: 'secret' },
    });
    const deps = makeDeps({ pipeline });
    const server = createServer(deps);

    const response = await injectJson(server, payload, { 'x-hook-signature': signature });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'accepted', deliveryId: 'delivery_01' });
    expect(insertDelivery).toHaveBeenCalled();
  });

  it('returns ok health status with uptime and timestamp', async () => {
    const deps = makeDeps();
    const server = createServer(deps);

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      timestamp: expect.any(String),
    });
  });
});
