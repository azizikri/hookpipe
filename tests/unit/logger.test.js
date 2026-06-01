import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Logger Utility', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.HOOKPIPE_LOG_LEVEL;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.HOOKPIPE_LOG_LEVEL;
    } else {
      process.env.HOOKPIPE_LOG_LEVEL = originalEnv;
    }
  });

  describe('createLogger', () => {
    it('returns a pino logger instance with expected methods', async () => {
      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger();

      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.trace).toBe('function');
      expect(typeof logger.fatal).toBe('function');
    });

    it('outputs valid JSON', async () => {
      const { createLogger } = await import('../../src/utils/logger.js');
      const chunks = [];
      const stream = { write: (chunk) => chunks.push(chunk) };
      const logger = createLogger({ stream });

      logger.info('test message');

      expect(chunks.length).toBeGreaterThan(0);
      const parsed = JSON.parse(chunks[0]);
      expect(parsed.msg).toBe('test message');
      expect(parsed.level).toBe(30); // info = 30
    });

    it('defaults to info level', async () => {
      delete process.env.HOOKPIPE_LOG_LEVEL;
      // Re-import to pick up env change
      const { createLogger } = await import('../../src/utils/logger.js');
      const chunks = [];
      const stream = { write: (chunk) => chunks.push(chunk) };
      const logger = createLogger({ stream });

      logger.debug('should not appear');
      logger.info('should appear');

      expect(chunks.length).toBe(1);
      expect(JSON.parse(chunks[0]).msg).toBe('should appear');
    });

    it('respects HOOKPIPE_LOG_LEVEL env var', async () => {
      process.env.HOOKPIPE_LOG_LEVEL = 'debug';
      const { createLogger } = await import('../../src/utils/logger.js');
      const chunks = [];
      const stream = { write: (chunk) => chunks.push(chunk) };
      const logger = createLogger({ level: process.env.HOOKPIPE_LOG_LEVEL, stream });

      logger.debug('debug msg');

      expect(chunks.length).toBe(1);
      expect(JSON.parse(chunks[0]).msg).toBe('debug msg');
    });

    it('redacts secret fields by default', async () => {
      const { createLogger } = await import('../../src/utils/logger.js');
      const chunks = [];
      const stream = { write: (chunk) => chunks.push(chunk) };
      const logger = createLogger({ stream });

      logger.info({ user: { password: 'hunter2', name: 'bob' } }, 'login');

      const parsed = JSON.parse(chunks[0]);
      expect(parsed.user.password).toBe('[Redacted]');
      expect(parsed.user.name).toBe('bob');
    });

    it('redacts token and secret fields', async () => {
      const { createLogger } = await import('../../src/utils/logger.js');
      const chunks = [];
      const stream = { write: (chunk) => chunks.push(chunk) };
      const logger = createLogger({ stream });

      logger.info({ api: { token: 'abc123', secret: 's3cr3t', url: 'http://x' } }, 'req');

      const parsed = JSON.parse(chunks[0]);
      expect(parsed.api.token).toBe('[Redacted]');
      expect(parsed.api.secret).toBe('[Redacted]');
      expect(parsed.api.url).toBe('http://x');
    });
  });

  describe('default logger export', () => {
    it('exports a default logger instance', async () => {
      const { default: logger } = await import('../../src/utils/logger.js');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
    });
  });
});
