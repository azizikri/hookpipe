import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../../src/server.js';
import { initDatabase, closeDatabase } from '../../src/db/index.js';
import { getJobsByDelivery } from '../../src/db/queries.js';
import { SqliteQueue } from '../../src/queue/sqlite-queue.js';
import { PipelineLoader } from '../../src/pipeline-loader.js';
import { PluginLoader } from '../../src/plugin-loader.js';
import { registry } from '../../src/destinations/index.js';
import { createLogger } from '../../src/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '..', 'fixtures');

const loadFixture = async (name) => JSON.parse(await readFile(path.join(fixturesDir, name), 'utf8'));

const pipelineYaml = (destinationUrl) => `
id: hot-pipeline
name: Hot Pipeline
destinations:
  - id: primary
    type: http
    url: ${destinationUrl}
retry:
  maxAttempts: 3
`;

const waitForReload = (pipelineLoader) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    pipelineLoader.off('reloaded', onReloaded);
    reject(new Error('pipeline reload event was not emitted'));
  }, 3000);
  const onReloaded = (pipeline) => {
    clearTimeout(timer);
    resolve(pipeline);
  };
  pipelineLoader.once('reloaded', onReloaded);
});

const buildStack = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hookpipe-hot-reload-'));
  const dbDir = path.join(root, 'db');
  const pipelinesDir = path.join(root, 'pipelines');
  const pluginsDir = path.join(root, 'plugins');
  await mkdir(dbDir, { recursive: true });
  await mkdir(pipelinesDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true });
  const pipelineFile = path.join(pipelinesDir, 'hot.yaml');
  await writeFile(pipelineFile, pipelineYaml('http://127.0.0.1:65535/a'));

  const db = initDatabase(path.join(dbDir, 'hookpipe.sqlite'));
  const queue = new SqliteQueue(db, { pollIntervalMs: 10, concurrency: 1 });
  const pipelineLoader = new PipelineLoader(pipelinesDir);
  const pluginLoader = new PluginLoader(pluginsDir);
  await pipelineLoader.loadAll();
  await pipelineLoader.startWatching();
  const logger = createLogger({ level: 'silent' });
  const server = createServer({ pipelineLoader, pluginLoader, queue, db, logger, destinationRegistry: registry });

  return { root, db, queue, pipelineLoader, pluginLoader, server, pipelineFile };
};

describe('pipeline hot-reload integration', () => {
  let stack;
  let payload;
  let headers;

  beforeAll(async () => {
    payload = await loadFixture('github-push-payload.json');
    headers = await loadFixture('github-push-headers.json');
    stack = await buildStack();
  });

  afterAll(async () => {
    stack?.pipelineLoader?.stopWatching();
    if (stack?.server) await stack.server.close();
    if (stack?.db) closeDatabase(stack.db);
    if (stack?.root) await rm(stack.root, { recursive: true, force: true });
  });

  it('accepts webhooks before reload and updates loader config after pipeline YAML changes', async () => {
    expect(stack.pipelineLoader.get('hot-pipeline').destinations[0].url).toBe('http://127.0.0.1:65535/a');

    const response = await stack.server.inject({
      method: 'POST',
      url: '/hook/hot-pipeline',
      headers,
      payload: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('accepted');
    expect(getJobsByDelivery(stack.db, response.json().deliveryId)).toHaveLength(1);

    const reloaded = waitForReload(stack.pipelineLoader);
    await writeFile(stack.pipelineFile, pipelineYaml('http://127.0.0.1:65535/b'));
    const config = await reloaded;

    expect(config.id).toBe('hot-pipeline');
    expect(stack.pipelineLoader.get('hot-pipeline').destinations[0].url).toBe('http://127.0.0.1:65535/b');
  });
});
