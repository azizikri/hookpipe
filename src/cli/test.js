import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../utils/config.js';
import { PipelineLoader } from '../pipeline-loader.js';
import { PluginLoader } from '../plugin-loader.js';
import { verifyWebhookAuth } from '../auth/hmac.js';
import { renderTemplate } from '../templates/handlebars.js';

function collectHeader(value, previous) {
  return previous.concat([value]);
}

export function testCommand(program) {
  program
    .command('test')
    .description('Dry-run a webhook through a pipeline')
    .argument('<pipeline-id>', 'Pipeline ID to test')
    .option('-f, --file <path>', 'JSON file to use as payload')
    .option('-d, --data <json>', 'Inline JSON payload')
    .option('--header <header>', 'Custom header (repeatable, format: "Key: Value")', collectHeader, [])
    .option('--skip-auth', 'Skip HMAC authentication check')
    .option('-c, --config <path>', 'Config file path')
    .action(async (pipelineId, opts) => {
      try {
        await runTest(pipelineId, opts);
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}

async function runTest(pipelineId, opts) {
  const overrides = {};
  if (opts.config) overrides.configPath = opts.config;

  const config = loadConfig(overrides);
  const pipelineLoader = new PipelineLoader(config.pipelines.dir);
  const pluginLoader = new PluginLoader(config.plugins.dir);

  await pipelineLoader.loadAll();

  const pipeline = pipelineLoader.get(pipelineId);
  if (!pipeline) {
    throw new Error(`Pipeline "${pipelineId}" not found`);
  }

  // Read payload
  let payload = {};
  if (opts.file) {
    const filePath = resolve(opts.file);
    const raw = readFileSync(filePath, 'utf-8');
    payload = JSON.parse(raw);
  } else if (opts.data) {
    payload = JSON.parse(opts.data);
  }

  // Parse headers
  const headers = {};
  for (const h of opts.header) {
    const colonIdx = h.indexOf(':');
    if (colonIdx > 0) {
      const key = h.slice(0, colonIdx).trim().toLowerCase();
      const value = h.slice(colonIdx + 1).trim();
      headers[key] = value;
    }
  }

  const result = {
    pipeline: pipelineId,
    payload,
    headers,
    steps: {},
  };

  // Auth check
  if (pipeline.auth && !opts.skipAuth) {
    const rawBody = JSON.stringify(payload);
    const authResult = verifyWebhookAuth(rawBody, headers, pipeline.auth);
    result.steps.auth = {
      status: authResult.valid ? 'passed' : 'failed',
      error: authResult.error || null,
    };
  } else if (opts.skipAuth) {
    result.steps.auth = { status: 'skipped' };
  }

  // Filter check
  if (pipeline.filter) {
    try {
      const filterFn = pluginLoader.loadFilter(pipeline.filter);
      const filterResult = filterFn(payload, headers, pipeline.filter_config || {});
      result.steps.filter = {
        status: filterResult.pass ? 'pass' : 'drop',
        reason: filterResult.reason || null,
      };
    } catch (err) {
      result.steps.filter = { status: 'error', error: err.message };
    }
  }

  // Transform check
  if (pipeline.transform) {
    try {
      const transformFn = pluginLoader.loadTransform(pipeline.transform);
      const transformed = transformFn(payload, headers, pipeline.filter_config || {});
      result.steps.transform = {
        before: payload,
        after: transformed,
      };
      if (transformed !== null) {
        payload = transformed;
      }
    } catch (err) {
      result.steps.transform = { status: 'error', error: err.message };
    }
  }

  // Destinations (dry-run preview)
  if (pipeline.destinations) {
    result.steps.destinations = pipeline.destinations.map((dest) => {
      const body = (result.steps.transform && result.steps.transform.after !== undefined)
        ? result.steps.transform.after
        : payload;
      return {
        url: dest.url,
        method: (dest.method || 'POST').toUpperCase(),
        headers: dest.headers || {},
        bodyPreview: body != null ? JSON.stringify(body).slice(0, 500) : '(empty)',
      };
    });
  }

  console.log(JSON.stringify(result, null, 2));
}
