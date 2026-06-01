import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('loadConfig', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function getLoadConfig() {
    const mod = await import('../../src/utils/config.js');
    return mod.loadConfig;
  }

  it('returns defaults when no config file, no env, no overrides', async () => {
    delete process.env.HOOKPIPE_CONFIG;
    delete process.env.HOOKPIPE_PORT;
    delete process.env.HOOKPIPE_HOST;
    delete process.env.HOOKPIPE_DB_PATH;
    delete process.env.HOOKPIPE_LOG_LEVEL;
    delete process.env.HOOKPIPE_PIPELINES_DIR;
    delete process.env.HOOKPIPE_PLUGINS_DIR;

    const loadConfig = await getLoadConfig();
    // Point to a non-existent config file so YAML loading is skipped
    const config = loadConfig({ _configPath: '/tmp/nonexistent-hookpipe.yaml' });

    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(3000);
    expect(config.db.path).toBe('./data/hookpipe.db');
    expect(config.log.level).toBe('info');
    expect(config.pipelines.dir).toBe('./pipelines');
    expect(config.plugins.dir).toBe('./plugins');
    expect(config.retry.maxAttempts).toBe(3);
    expect(config.retry.backoff).toBe('exponential');
    expect(config.retry.initialDelayMs).toBe(1000);
    expect(config.retry.maxDelayMs).toBe(300000);
    expect(config.queue.pollIntervalMs).toBe(1000);
    expect(config.queue.concurrency).toBe(5);
  });

  it('loads and merges YAML config file', async () => {
    const fixturePath = path.join(__dirname, '../fixtures/test-config.yaml');
    const loadConfig = await getLoadConfig();
    const config = loadConfig({ _configPath: fixturePath });

    expect(config.port).toBe(4000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.db.path).toBe('./custom/data.db');
    // Defaults still present for unset values
    expect(config.retry.maxAttempts).toBe(3);
  });

  it('env variables override YAML and defaults', async () => {
    process.env.HOOKPIPE_PORT = '5000';
    process.env.HOOKPIPE_HOST = '192.168.1.1';
    process.env.HOOKPIPE_DB_PATH = '/var/db/hook.db';
    process.env.HOOKPIPE_LOG_LEVEL = 'debug';
    process.env.HOOKPIPE_PIPELINES_DIR = '/etc/pipelines';
    process.env.HOOKPIPE_PLUGINS_DIR = '/etc/plugins';

    const loadConfig = await getLoadConfig();
    const config = loadConfig({ _configPath: '/tmp/nonexistent-hookpipe.yaml' });

    expect(config.port).toBe(5000);
    expect(config.host).toBe('192.168.1.1');
    expect(config.db.path).toBe('/var/db/hook.db');
    expect(config.log.level).toBe('debug');
    expect(config.pipelines.dir).toBe('/etc/pipelines');
    expect(config.plugins.dir).toBe('/etc/plugins');
  });

  it('CLI overrides take highest precedence', async () => {
    process.env.HOOKPIPE_PORT = '5000';

    const fixturePath = path.join(__dirname, '../fixtures/test-config.yaml');
    const loadConfig = await getLoadConfig();
    const config = loadConfig({ port: 9999, host: '10.0.0.1', _configPath: fixturePath });

    expect(config.port).toBe(9999);
    expect(config.host).toBe('10.0.0.1');
    // env still wins over YAML for non-overridden
    expect(config.db.path).toBe('./custom/data.db'); // from YAML (no env set for this)
  });

  it('interpolates ${ENV_VAR} in YAML string values', async () => {
    process.env.MY_DB_HOST = 'prod-db.example.com';
    process.env.MY_LOG = 'warn';

    const fixturePath = path.join(__dirname, '../fixtures/interpolation-config.yaml');
    const loadConfig = await getLoadConfig();
    const config = loadConfig({ _configPath: fixturePath });

    expect(config.db.path).toBe('./data/prod-db.example.com.db');
    expect(config.log.level).toBe('warn');

    delete process.env.MY_DB_HOST;
    delete process.env.MY_LOG;
  });

  it('interpolates missing env vars as empty string', async () => {
    delete process.env.MY_DB_HOST;
    delete process.env.MY_LOG;

    const fixturePath = path.join(__dirname, '../fixtures/interpolation-config.yaml');
    const loadConfig = await getLoadConfig();
    const config = loadConfig({ _configPath: fixturePath });

    expect(config.db.path).toBe('./data/.db');
    expect(config.log.level).toBe('');
  });

  it('missing config file does not throw', async () => {
    const loadConfig = await getLoadConfig();
    expect(() => loadConfig({ _configPath: '/tmp/does-not-exist.yaml' })).not.toThrow();
  });

  it('HOOKPIPE_CONFIG env var sets config file path', async () => {
    const fixturePath = path.join(__dirname, '../fixtures/test-config.yaml');
    process.env.HOOKPIPE_CONFIG = fixturePath;

    const loadConfig = await getLoadConfig();
    const config = loadConfig();

    expect(config.port).toBe(4000);
    expect(config.host).toBe('127.0.0.1');

    delete process.env.HOOKPIPE_CONFIG;
  });

  it('port from env is coerced to number', async () => {
    process.env.HOOKPIPE_PORT = '8080';

    const loadConfig = await getLoadConfig();
    const config = loadConfig({ _configPath: '/tmp/nonexistent.yaml' });

    expect(config.port).toBe(8080);
    expect(typeof config.port).toBe('number');
  });
});
