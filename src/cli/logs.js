import { loadConfig } from '../utils/config.js';
import { initDatabase, closeDatabase } from '../db/index.js';
import { listDeliveries } from '../db/queries.js';

/**
 * Parse a duration string (e.g., '1h', '24h', '7d', '30m') into an ISO date string.
 */
export function parseSince(duration) {
  const match = duration.match(/^(\d+)([mhd])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use Nm, Nh, or Nd.`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  const ms = value * multipliers[unit];
  return new Date(Date.now() - ms).toISOString();
}

/**
 * Format deliveries as a table string.
 */
function formatTable(deliveries) {
  if (deliveries.length === 0) {
    return 'No delivery logs found.';
  }

  const header = `${'ID'.padEnd(38)} ${'Pipeline'.padEnd(20)} ${'Status'.padEnd(12)} Received At`;
  const separator = '-'.repeat(header.length);
  const rows = deliveries.map((d) => {
    const id = (d.id || '').padEnd(38);
    const pipeline = (d.pipeline_id || '').padEnd(20);
    const status = (d.status || '').padEnd(12);
    const received = d.received_at || '';
    return `${id} ${pipeline} ${status} ${received}`;
  });

  return [header, separator, ...rows].join('\n');
}

/**
 * Register the 'logs' command on the Commander program.
 */
export function logsCommand(program) {
  program
    .command('logs')
    .description('Query delivery logs')
    .option('-p, --pipeline <id>', 'Filter by pipeline ID')
    .option('-s, --status <status>', 'Filter by status (pending/delivered/failed/dead_letter)')
    .option('--since <duration>', "Show logs since duration (e.g., '1h', '24h', '7d', '30m')")
    .option('-n, --limit <number>', 'Max results', '50')
    .option('--offset <number>', 'Pagination offset', '0')
    .option('-c, --config <path>', 'Config file path')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const config = loadConfig(opts.config ? { configPath: opts.config } : {});
      const db = initDatabase(config.db.path);

      try {
        const filters = {
          pipelineId: opts.pipeline,
          status: opts.status,
          limit: parseInt(opts.limit, 10),
          offset: parseInt(opts.offset, 10),
          since: opts.since ? parseSince(opts.since) : undefined,
        };

        const deliveries = listDeliveries(db, filters);

        if (opts.json) {
          console.log(JSON.stringify(deliveries, null, 2));
        } else {
          console.log(formatTable(deliveries));
        }
      } finally {
        closeDatabase(db);
      }
    });
}
