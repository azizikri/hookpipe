import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../../src/server.js';
import { initDatabase, closeDatabase } from '../../src/db/index.js';
import { getDelivery, getJobsByDelivery } from '../../src/db/queries.js';
import { SqliteQueue } from '../../src/queue/sqlite-queue.js';
import { PipelineLoader } from '../../src/pipeline-loader.js';
import { PluginLoader } from '../../src/plugin-loader.js';
import { registry } from '../../src/destinations/index.js';
import { createLogger } from '../../src/utils/logger.js';
import { computeHmac } from '../../src/utils/crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '..', 'fixtures');
const secret = 'integration-secret';

const loadFixture = async (name) => JSON.parse(await readFile(path.join(fixturesDir, name), 'utf8'));

const writePluginFiles = async (pluginsDir) => {
  await writeFile(path.join(pluginsDir, 'github-filter.cjs'), `
exports.filter = async function filter(payload) {
  return payload.ref === 'refs/heads/main'
    ? { pass: true }
    : { pass: false, reason: 'non-main branch' };
};
`);
  await writeFile(path.join(pluginsDir, 'github-transform.cjs'), `
exports.transform = async function transform(payload, headers, config) {
  return {
    repository: payload.repository.full_name,
    ref: payload.ref,
    commitCount: payload.commits.length,
    firstCommit: payload.commits[0].id,
    event: headers['x-github-event'],
    transformedBy: config.name
  };
};
`);
};

const writePipeline = async (pipelinesDir) => writeFile(path.join(pipelinesDir, 'github.yaml'), `
id: github-push
name: GitHub Push
auth:
  type: hmac-sha256
  header: x-hub-signature-256
  secret: ${secret}
filter:
  path: github-filter.cjs
transform:
  path: github-transform.cjs
  config:
    name: webhook-flow-test
destinations:
  - id: primary
    type: http
    url: http://127.0.0.1:65535/webhook
retry:
  maxAttempts: 3
`);

const buildStack = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hookpipe-webhook-flow-'));
  const dbDir = path.join(root, 'db');
  const pipelinesDir = path.join(root, 'pipelines');
  const pluginsDir = path.join(root, 'plugins');
  await mkdir(dbDir, { recursive: true });
  await mkdir(pipelinesDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true });
  await writePluginFiles(pluginsDir);
  await writePipeline(pipelinesDir);

  const db = initDatabase(path.join(dbDir, 'hookpipe.sqlite'));
  const queue = new SqliteQueue(db, { pollIntervalMs: 10, concurrency: 1 });
  const pipelineLoader = new PipelineLoader(pipelinesDir);
  const pluginLoader = new PluginLoader(pluginsDir);
  await pipelineLoader.loadAll();
  const logger = createLogger({ level: 'silent' });
  const server = createServer({ pipelineLoader, pluginLoader, queue, db, logger, destinationRegistry: registry });

  return { root, db, queue, pipelineLoader, pluginLoader, server };
};

const signedHeaders = (payload, headers) => {
  const raw = JSON.stringify(payload);
  return {
    ...headers,
    'x-hub-signature-256': `sha256=${computeHmac('sha256', secret, raw)}`,
  };
};

describe('webhook flow integration', () => {
  let stack;
  let payload;
  let headers;

  beforeAll(async () => {
    payload = await loadFixture('github-push-payload.json');
    headers = await loadFixture('github-push-headers.json');
    stack = await buildStack();
  });

  afterAll(async () => {
    if (stack?.server) await stack.server.close();
    if (stack?.db) closeDatabase(stack.db);
    if (stack?.root) await rm(stack.root, { recursive: true, force: true });
  });

  it('accepts a valid webhook, creates a delivery record, and enqueues a job', async () => {
    const response = await stack.server.inject({
      method: 'POST',
      url: '/hook/github-push',
      headers: signedHeaders(payload, headers),
      payload: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('accepted');

    const delivery = getDelivery(stack.db, body.deliveryId);
    expect(delivery).toMatchObject({ pipeline_id: 'github-push', status: 'queued' });
    expect(delivery.payload).toMatchObject({ repository: 'org/repo', commitCount: 1 });

    const jobs = getJobsByDelivery(stack.db, body.deliveryId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ destination_id: 'primary', pipeline_id: 'github-push', status: 'pending' });
  });

  it('rejects a webhook with the wrong HMAC signature', async () => {
    const response = await stack.server.inject({
      method: 'POST',
      url: '/hook/github-push',
      headers: { ...headers, 'x-hub-signature-256': 'sha256=wrong' },
      payload: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Authentication failed', details: 'Invalid signature' });
  });

  it('returns filtered when the real filter plugin rejects the payload', async () => {
    stack = await buildStack();
    const branchPayload = { ...payload, ref: 'refs/heads/topic' };

    const response = await stack.server.inject({
      method: 'POST',
      url: '/hook/github-push',
      headers: signedHeaders(branchPayload, headers),
      payload: JSON.stringify(branchPayload),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'filtered', reason: 'non-main branch' });
  });

  it('enqueues the transformed payload from the real transform plugin', async () => {
    const response = await stack.server.inject({
      method: 'POST',
      url: '/hook/github-push',
      headers: signedHeaders(payload, headers),
      payload: JSON.stringify(payload),
    });

    const jobs = getJobsByDelivery(stack.db, response.json().deliveryId);
    expect(jobs[0].payload).toEqual({
      repository: 'org/repo',
      ref: 'refs/heads/main',
      commitCount: 1,
      firstCommit: 'abc1234567890',
      event: 'push',
      transformedBy: 'webhook-flow-test',
    });
  });

  it('returns ok from the health check', async () => {
    const response = await stack.server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      timestamp: expect.any(String),
    });
  });
});
