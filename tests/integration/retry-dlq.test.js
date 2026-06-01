import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../../src/server.js';
import { initDatabase, closeDatabase } from '../../src/db/index.js';
import { getAttemptsByDelivery, getDelivery, getJobsByDelivery } from '../../src/db/queries.js';
import { SqliteQueue } from '../../src/queue/sqlite-queue.js';
import { PipelineLoader } from '../../src/pipeline-loader.js';
import { PluginLoader } from '../../src/plugin-loader.js';
import { DestinationRegistry } from '../../src/destinations/index.js';
import { DeliveryWorker } from '../../src/delivery/worker.js';
import { createLogger } from '../../src/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '..', 'fixtures');

const loadFixture = async (name) => JSON.parse(await readFile(path.join(fixturesDir, name), 'utf8'));

class ThrowingHttpAdapter {
  get type() {
    return 'http';
  }

  async send(payload, destConfig) {
    const response = await fetch(destConfig.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body}`);
    }
    return { statusCode: response.status, body };
  }
}

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const closeHttpServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});

const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 2000;
  let value;
  while (Date.now() < deadline) {
    value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
};

const writePipeline = async (pipelinesDir, url) => writeFile(path.join(pipelinesDir, 'retry.yaml'), `
id: retry-pipeline
name: Retry Pipeline
destinations:
  - id: failing-destination
    type: http
    url: ${url}
retry:
  maxAttempts: 1
  backoff: fixed
  initialDelayMs: 60000
  maxDelayMs: 60000
`);

const buildStack = async (destinationUrl) => {
  const root = await mkdtemp(path.join(tmpdir(), 'hookpipe-retry-dlq-'));
  const dbDir = path.join(root, 'db');
  const pipelinesDir = path.join(root, 'pipelines');
  const pluginsDir = path.join(root, 'plugins');
  await mkdir(dbDir, { recursive: true });
  await mkdir(pipelinesDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true });
  await writePipeline(pipelinesDir, destinationUrl);

  const db = initDatabase(path.join(dbDir, 'hookpipe.sqlite'));
  const queue = new SqliteQueue(db, { pollIntervalMs: 10, concurrency: 1 });
  const pipelineLoader = new PipelineLoader(pipelinesDir);
  const pluginLoader = new PluginLoader(pluginsDir);
  await pipelineLoader.loadAll();
  const destinationRegistry = new DestinationRegistry();
  destinationRegistry.register(new ThrowingHttpAdapter());
  const logger = createLogger({ level: 'silent' });
  const server = createServer({ pipelineLoader, pluginLoader, queue, db, logger, destinationRegistry });
  const worker = new DeliveryWorker({
    queue,
    db,
    destinationRegistry,
    logger,
    getPipeline: (pipelineId) => pipelineLoader.get(pipelineId),
    config: { pollIntervalMs: 10, concurrency: 1 },
  });

  return { root, db, queue, pipelineLoader, pluginLoader, destinationRegistry, server, worker };
};

const enqueueWebhook = async (stack, payload, headers) => {
  const response = await stack.server.inject({
    method: 'POST',
    url: '/hook/retry-pipeline',
    headers,
    payload: JSON.stringify(payload),
  });
  expect(response.statusCode).toBe(200);
  return response.json().deliveryId;
};

const runOneWorkerPoll = async (stack, deliveryId, expectedAttempts) => {
  stack.worker.start();
  await waitFor(() => getAttemptsByDelivery(stack.db, deliveryId).length >= expectedAttempts, 'worker did not log expected attempt');
  stack.worker.stop();
};

describe('retry and DLQ integration', () => {
  let failingServer;
  let stack;
  let payload;
  let headers;

  beforeAll(async () => {
    payload = await loadFixture('github-push-payload.json');
    headers = await loadFixture('github-push-headers.json');
    failingServer = createHttpServer((request, response) => {
      request.resume();
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end('destination failed');
    });
    const port = await listen(failingServer);
    stack = await buildStack(`http://127.0.0.1:${port}/webhook`);
  });

  afterAll(async () => {
    stack?.worker?.stop();
    if (stack?.server) await stack.server.close();
    if (stack?.db) closeDatabase(stack.db);
    if (stack?.root) await rm(stack.root, { recursive: true, force: true });
    if (failingServer) await closeHttpServer(failingServer);
  });

  it('logs a failed attempt and nacks the job with next_attempt_at when retries remain', async () => {
    const deliveryId = await enqueueWebhook(stack, payload, headers);

    await runOneWorkerPoll(stack, deliveryId, 1);

    const attempts = getAttemptsByDelivery(stack.db, deliveryId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      delivery_id: deliveryId,
      destination_id: 'failing-destination',
      attempt_number: 0,
      status: 'failure',
    });
    expect(attempts[0].error_message).toContain('HTTP 500');

    const [job] = getJobsByDelivery(stack.db, deliveryId);
    expect(job).toMatchObject({ status: 'pending', attempts: 1 });
    expect(new Date(job.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('moves an exhausted job to dead letter and marks delivery dead_letter', async () => {
    const deliveryId = await enqueueWebhook(stack, payload, headers);
    await runOneWorkerPoll(stack, deliveryId, 1);

    const [jobAfterRetry] = getJobsByDelivery(stack.db, deliveryId);
    stack.db.prepare("UPDATE queue_jobs SET next_attempt_at = datetime('now') WHERE id = ?").run(jobAfterRetry.id);

    await runOneWorkerPoll(stack, deliveryId, 2);

    const attempts = getAttemptsByDelivery(stack.db, deliveryId);
    expect(attempts).toHaveLength(2);
    expect(attempts.every((attempt) => attempt.status === 'failure')).toBe(true);

    const [job] = getJobsByDelivery(stack.db, deliveryId);
    expect(job.status).toBe('dead_letter');

    const deadLetter = stack.db.prepare('SELECT * FROM dead_letters WHERE delivery_id = ?').get(deliveryId);
    expect(deadLetter).toMatchObject({
      delivery_id: deliveryId,
      pipeline_id: 'retry-pipeline',
      destination_id: 'failing-destination',
      attempts: 1,
    });
    expect(deadLetter.error_message).toContain('HTTP 500');

    const delivery = getDelivery(stack.db, deliveryId);
    expect(delivery.status).toBe('dead_letter');
  });
});
