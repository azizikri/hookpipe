import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULTS = {
  host: '0.0.0.0',
  port: 3000,
  db: { path: './data/hookpipe.db' },
  log: { level: 'info' },
  pipelines: { dir: './pipelines' },
  plugins: { dir: './plugins' },
  retry: { maxAttempts: 3, backoff: 'exponential', initialDelayMs: 1000, maxDelayMs: 300000 },
  queue: { pollIntervalMs: 1000, concurrency: 5 },
};

const ENV_MAP = {
  HOOKPIPE_PORT: 'port',
  HOOKPIPE_HOST: 'host',
  HOOKPIPE_DB_PATH: 'db.path',
  HOOKPIPE_LOG_LEVEL: 'log.level',
  HOOKPIPE_PIPELINES_DIR: 'pipelines.dir',
  HOOKPIPE_PLUGINS_DIR: 'plugins.dir',
};

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function interpolateEnv(obj) {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, varName) => process.env[varName] ?? '');
  }
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnv(value);
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateEnv);
  }
  return obj;
}

function setNested(obj, dotPath, value) {
  const keys = dotPath.split('.');
  const last = keys.pop();
  let current = obj;
  for (const key of keys) {
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[last] = value;
}

function loadYaml(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) || {};
  } catch {
    return {};
  }
}

function resolveConfigPath(overridePath) {
  if (overridePath) return overridePath;
  if (process.env.HOOKPIPE_CONFIG) return process.env.HOOKPIPE_CONFIG;
  return path.join(process.cwd(), 'hookpipe.config.yaml');
}

function applyEnv() {
  const envConfig = {};
  for (const [envVar, configPath] of Object.entries(ENV_MAP)) {
    if (process.env[envVar] !== undefined) {
      let value = process.env[envVar];
      if (configPath === 'port') value = Number(value);
      setNested(envConfig, configPath, value);
    }
  }
  return envConfig;
}

export function loadConfig(overrides = {}) {
  const { _configPath, configPath, ...cliOverrides } = overrides;

  const configFilePath = resolveConfigPath(_configPath || configPath);
  const fileConfig = interpolateEnv(loadYaml(configFilePath));
  const envConfig = applyEnv();

  let config = deepMerge(DEFAULTS, fileConfig);
  config = deepMerge(config, envConfig);
  config = deepMerge(config, cliOverrides);

  return config;
}
