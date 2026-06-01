import { loadConfig } from '../utils/config.js';
import { initDatabase, closeDatabase } from '../db/index.js';
import { getDelivery } from '../db/queries.js';
import { SqliteQueue } from '../queue/sqlite-queue.js';
import { PipelineLoader } from '../pipeline-loader.js';

export function replayCommand(program) {
  program
    .command('replay')
    .description('Replay a webhook delivery')
    .argument('<delivery-id>', 'Delivery ID to replay')
    .option('--dry-run', 'Show what would be replayed without enqueuing')
    .option('-c, --config <path>', 'Config file path')
    .action(async (deliveryId, opts) => {
      const overrides = {};
      if (opts.config) overrides.configPath = opts.config;

      const config = loadConfig(overrides);
      const db = initDatabase(config.db.path);

      try {
        const delivery = getDelivery(db, deliveryId);

        if (!delivery) {
          console.error(`Delivery not found: ${deliveryId}`);
          process.exit(1);
        }

        const pipelineLoader = new PipelineLoader(config.pipelines.dir);
        await pipelineLoader.loadAll();

        const pipeline = pipelineLoader.get(delivery.pipeline_id);
        const destinations = pipeline?.destinations || [];

        if (opts.dryRun) {
          console.log(`Delivery: ${deliveryId}`);
          console.log(`Pipeline: ${delivery.pipeline_id}`);
          console.log(`Status: ${delivery.status}`);
          console.log(`Payload: ${JSON.stringify(delivery.payload).slice(0, 200)}`);
          console.log(`Would re-enqueue to destinations: [${destinations.map((d) => d.id).join(', ')}]`);
          return;
        }

        const queue = new SqliteQueue(db, config);
        const headers = delivery.headers || {};
        const payload = delivery.payload;

        for (const dest of destinations) {
          await queue.enqueue({
            deliveryId,
            destinationId: dest.id,
            pipelineId: delivery.pipeline_id,
            payload,
            headers,
            maxAttempts: pipeline?.retry?.maxAttempts ?? pipeline?.retry?.max_attempts ?? 3,
          });
        }

        console.log(`Replayed delivery ${deliveryId} to ${destinations.length} destinations`);
      } finally {
        closeDatabase(db);
      }
    });
}
