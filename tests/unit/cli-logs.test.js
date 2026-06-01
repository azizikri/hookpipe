import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({ database: { path: ':memory:' } }),
}));

vi.mock('../../src/db/index.js', () => ({
  initDatabase: vi.fn().mockResolvedValue({ mock: true }),
  closeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/queries.js', () => ({
  listDeliveries: vi.fn().mockResolvedValue([]),
}));

describe('CLI logs command', () => {
  let program;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
  });

  describe('command registration', () => {
    it('registers logs command with correct name', async () => {
      const { logsCommand } = await import('../../src/cli/logs.js');
      logsCommand(program);

      const cmd = program.commands.find((c) => c.name() === 'logs');
      expect(cmd).toBeDefined();
    });

    it('has --pipeline option', async () => {
      const { logsCommand } = await import('../../src/cli/logs.js');
      logsCommand(program);

      const cmd = program.commands.find((c) => c.name() === 'logs');
      const opt = cmd.options.find((o) => o.long === '--pipeline');
      expect(opt).toBeDefined();
      expect(opt.short).toBe('-p');
    });

    it('has --status option', async () => {
      const { logsCommand } = await import('../../src/cli/logs.js');
      logsCommand(program);

      const cmd = program.commands.find((c) => c.name() === 'logs');
      const opt = cmd.options.find((o) => o.long === '--status');
      expect(opt).toBeDefined();
      expect(opt.short).toBe('-s');
    });

    it('has --since option', async () => {
      const { logsCommand } = await import('../../src/cli/logs.js');
      logsCommand(program);

      const cmd = program.commands.find((c) => c.name() === 'logs');
      const opt = cmd.options.find((o) => o.long === '--since');
      expect(opt).toBeDefined();
    });

    it('has --limit option defaulting to 50', async () => {
      const { logsCommand } = await import('../../src/cli/logs.js');
      logsCommand(program);

      const cmd = program.commands.find((c) => c.name() === 'logs');
      const opt = cmd.options.find((o) => o.long === '--limit');
      expect(opt).toBeDefined();
      expect(opt.short).toBe('-n');
      expect(opt.defaultValue).toBe('50');
    });

    it('has --offset option defaulting to 0', async () => {
      const { logsCommand } = await import('../../src/cli/logs.js');
      logsCommand(program);

      const cmd = program.commands.find((c) => c.name() === 'logs');
      const opt = cmd.options.find((o) => o.long === '--offset');
      expect(opt).toBeDefined();
      expect(opt.defaultValue).toBe('0');
    });

    it('has --json flag', async () => {
      const { logsCommand } = await import('../../src/cli/logs.js');
      logsCommand(program);

      const cmd = program.commands.find((c) => c.name() === 'logs');
      const opt = cmd.options.find((o) => o.long === '--json');
      expect(opt).toBeDefined();
    });

    it('has --config option', async () => {
      const { logsCommand } = await import('../../src/cli/logs.js');
      logsCommand(program);

      const cmd = program.commands.find((c) => c.name() === 'logs');
      const opt = cmd.options.find((o) => o.long === '--config');
      expect(opt).toBeDefined();
      expect(opt.short).toBe('-c');
    });
  });

  describe('parseSince duration parsing', () => {
    it('parses 1h to approximately 1 hour ago', async () => {
      const { parseSince } = await import('../../src/cli/logs.js');
      const now = Date.now();
      const result = new Date(parseSince('1h')).getTime();
      const expected = now - 60 * 60 * 1000;
      expect(Math.abs(result - expected)).toBeLessThan(1000);
    });

    it('parses 24h to approximately 24 hours ago', async () => {
      const { parseSince } = await import('../../src/cli/logs.js');
      const now = Date.now();
      const result = new Date(parseSince('24h')).getTime();
      const expected = now - 24 * 60 * 60 * 1000;
      expect(Math.abs(result - expected)).toBeLessThan(1000);
    });

    it('parses 7d to approximately 7 days ago', async () => {
      const { parseSince } = await import('../../src/cli/logs.js');
      const now = Date.now();
      const result = new Date(parseSince('7d')).getTime();
      const expected = now - 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(result - expected)).toBeLessThan(1000);
    });

    it('parses 30m to approximately 30 minutes ago', async () => {
      const { parseSince } = await import('../../src/cli/logs.js');
      const now = Date.now();
      const result = new Date(parseSince('30m')).getTime();
      const expected = now - 30 * 60 * 1000;
      expect(Math.abs(result - expected)).toBeLessThan(1000);
    });
  });
});
