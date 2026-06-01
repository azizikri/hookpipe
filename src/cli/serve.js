import { loadConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { initDatabase, closeDatabase } from '../db/index.js';
import { SqliteQueue } from '../queue/sqlite-queue.js';
import { PipelineLoader } from '../pipeline-loader.js';
import { PluginLoader } from '../plugin-loader.js';
import { registry as destinationRegistry } from '../destinations/index.js';
import { DeliveryWorker } from '../delivery/worker.js';
import { createServer } from '../server.js';

export function serveCommand(program) {
  program
    .command('serve')
    .description('Start the hookpipe webhook server')
    .option('-p, --port <number>', 'Port to listen on')
    .option('-H, --host <string>', 'Host to bind to')
    .option('-c, --config <path>', 'Config file path')
    .option('--pipelines <dir>', 'Pipelines directory')
    .option('--plugins <dir>', 'Plugins directory')
    .action(async (opts) => {
      const overrides = {};
      if (opts.port) overrides.port = Number(opts.port);
      if (opts.host) overrides.host = opts.host;
      if (opts.pipelines) overrides.pipelines = { dir: opts.pipelines };
      if (opts.plugins) overrides.plugins = { dir: opts.plugins };
      if (opts.config) overrides.configPath = opts.config;

      const config = loadConfig(overrides);
      const logger = createLogger({ level: config.log.level });
      const db = initDatabase(config.db.path);
      const queue = new SqliteQueue(db, config);
      const pipelineLoader = new PipelineLoader(config.pipelines.dir);
      const pluginLoader = new PluginLoader(config.plugins.dir);
      const worker = new DeliveryWorker({
        queue,
        db,
        destinationRegistry,
        logger,
        getPipeline: (id) => pipelineLoader.get(id),
        config: { pollIntervalMs: config.queue?.poll_interval_ms ?? 1000, concurrency: config.queue?.concurrency ?? 5 },
      });

      const server = createServer({
        pipelineLoader,
        pluginLoader,
        queue,
        db,
        logger,
        config,
      });

      await pipelineLoader.loadAll();
      await pipelineLoader.startWatching();
      worker.start();

      const host = config.host || '0.0.0.0';
      const port = config.port || 3000;

      await server.listen({ port, host });
      logger.info(`Server listening on http://${host}:${port}`);

      const shutdown = async () => {
        logger.info('Shutting down...');
        worker.stop();
        pipelineLoader.stopWatching();
        server.close();
        closeDatabase(db);
        logger.info('Shutdown complete');
        process.exit(0);
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    });
}
