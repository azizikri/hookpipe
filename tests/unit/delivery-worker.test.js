import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/queries.js', () => ({
  insertAttempt: vi.fn(),
  updateDeliveryStatus: vi.fn(),
  incrementStat: vi.fn(),
}));

vi.mock('../../src/delivery/retry.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getNextAttemptTime: vi.fn(() => '2025-01-01T00:00:05.000Z'),
  };
});

vi.mock('ulid', () => ({
  ulid: vi.fn(() => 'attempt_01'),
}));

const { insertAttempt, updateDeliveryStatus, incrementStat } = await import('../../src/db/queries.js');
const { getNextAttemptTime } = await import('../../src/delivery/retry.js');
const { DeliveryWorker } = await import('../../src/delivery/worker.js');

const makeJob = (overrides = {}) => ({
  id: 'job_01',
  delivery_id: 'delivery_01',
  pipeline_id: 'pipeline_01',
  payload: JSON.stringify({ event: 'created' }),
  headers: JSON.stringify({ 'x-hookpipe-id': 'evt_01' }),
  attempts: 1,
  ...overrides,
});

const makePipeline = (overrides = {}) => ({
  id: 'pipeline_01',
  destination: {
    id: 'dest_01',
    type: 'http',
    url: 'https://example.com/webhook',
  },
  retry: {
    maxAttempts: 3,
    backoff: 'fixed',
    initialDelayMs: 5000,
    maxDelayMs: 5000,
  },
  ...overrides,
});

const makeWorker = ({ jobs = [], adapter, pipeline } = {}) => {
  const queue = {
    dequeue: vi.fn(async () => jobs),
    ack: vi.fn(async () => {}),
    nack: vi.fn(async () => {}),
    moveToDeadLetter: vi.fn(async () => {}),
  };
  const resolvedAdapter = adapter ?? { send: vi.fn(async () => ({ success: true, statusCode: 202, responseBody: 'ok' })) };
  const destinationRegistry = {
    getAdapter: vi.fn(() => resolvedAdapter),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const getPipeline = vi.fn(() => pipeline ?? makePipeline());
  const db = { name: 'db' };
  const worker = new DeliveryWorker({
    queue,
    db,
    destinationRegistry,
    logger,
    getPipeline,
    config: { pollIntervalMs: 10, concurrency: 2 },
  });

  return { worker, queue, db, destinationRegistry, logger, getPipeline, adapter: resolvedAdapter };
};

const flushPromises = () => Promise.resolve();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DeliveryWorker', () => {
  it('processes a successful job, acks it, logs attempt, updates delivery, and increments delivered stat', async () => {
    vi.useFakeTimers();
    const job = makeJob();
    const { worker, queue, db, destinationRegistry, getPipeline, adapter } = makeWorker({ jobs: [job] });

    worker.start();
    await vi.advanceTimersByTimeAsync(10);
    await flushPromises();
    worker.stop();
    vi.useRealTimers();

    expect(getPipeline).toHaveBeenCalledWith('pipeline_01');
    expect(destinationRegistry.getAdapter).toHaveBeenCalledWith('http');
    expect(adapter.send).toHaveBeenCalledWith(
      { event: 'created' },
      makePipeline().destination,
      {
        deliveryId: 'delivery_01',
        pipelineId: 'pipeline_01',
        attempt: 1,
        headers: { 'x-hookpipe-id': 'evt_01' },
      },
    );
    expect(queue.ack).toHaveBeenCalledWith('job_01');
    expect(insertAttempt).toHaveBeenCalledWith(db, expect.objectContaining({
      id: 'attempt_01',
      deliveryId: 'delivery_01',
      destinationId: 'dest_01',
      attemptNumber: 1,
      status: 'success',
      statusCode: 202,
      responseBody: 'ok',
      errorMessage: null,
    }));
    expect(updateDeliveryStatus).toHaveBeenCalledWith(db, 'delivery_01', 'delivered');
    expect(incrementStat).toHaveBeenCalledWith(db, 'pipeline_01', 'total_delivered');
  });

  it('nacks a failed job with a next attempt time when retries remain', async () => {
    vi.useFakeTimers();
    const error = new Error('network down');
    const adapter = { send: vi.fn(async () => { throw error; }) };
    const job = makeJob({ attempts: 2 });
    const { worker, queue, db } = makeWorker({ jobs: [job], adapter });

    worker.start();
    await vi.advanceTimersByTimeAsync(10);
    await flushPromises();
    worker.stop();
    vi.useRealTimers();

    expect(getNextAttemptTime).toHaveBeenCalledWith(2, makePipeline().retry);
    expect(queue.nack).toHaveBeenCalledWith('job_01', error, '2025-01-01T00:00:05.000Z');
    expect(insertAttempt).toHaveBeenCalledWith(db, expect.objectContaining({
      deliveryId: 'delivery_01',
      destinationId: 'dest_01',
      attemptNumber: 2,
      status: 'failure',
      errorMessage: 'network down',
    }));
    expect(updateDeliveryStatus).not.toHaveBeenCalled();
    expect(incrementStat).not.toHaveBeenCalled();
  });

  it('moves a failed job to dead letter when attempts are exhausted', async () => {
    vi.useFakeTimers();
    const error = new Error('still broken');
    const adapter = { send: vi.fn(async () => { throw error; }) };
    const job = makeJob({ attempts: 3 });
    const { worker, queue, db } = makeWorker({ jobs: [job], adapter });

    worker.start();
    await vi.advanceTimersByTimeAsync(10);
    await flushPromises();
    worker.stop();
    vi.useRealTimers();

    expect(queue.moveToDeadLetter).toHaveBeenCalledWith('job_01', error);
    expect(insertAttempt).toHaveBeenCalledWith(db, expect.objectContaining({
      deliveryId: 'delivery_01',
      attemptNumber: 3,
      status: 'failure',
      errorMessage: 'still broken',
    }));
    expect(updateDeliveryStatus).toHaveBeenCalledWith(db, 'delivery_01', 'dead_letter');
    expect(incrementStat).toHaveBeenCalledWith(db, 'pipeline_01', 'total_failed');
  });

  it('poll dequeues up to the configured concurrency', async () => {
    vi.useFakeTimers();
    const { worker, queue } = makeWorker({ jobs: [] });

    worker.start();
    await vi.advanceTimersByTimeAsync(10);
    await flushPromises();
    worker.stop();
    vi.useRealTimers();

    expect(queue.dequeue).toHaveBeenCalledWith(2);
  });

  it('start and stop control the polling interval', async () => {
    vi.useFakeTimers();
    const { worker, queue } = makeWorker({ jobs: [] });

    worker.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(queue.dequeue).toHaveBeenCalledTimes(1);

    worker.stop();
    await vi.advanceTimersByTimeAsync(30);
    expect(queue.dequeue).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
