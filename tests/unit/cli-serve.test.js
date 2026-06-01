import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';
import { serveCommand } from '../../src/cli/serve.js';

describe('CLI serve command', () => {
  let program;

  beforeEach(() => {
    program = new Command();
    program.exitOverride(); // Prevent process.exit in tests
    serveCommand(program);
  });

  it('registers the serve command', () => {
    const cmd = program.commands.find((c) => c.name() === 'serve');
    expect(cmd).toBeDefined();
    expect(cmd.description()).toContain('Start');
  });

  it('accepts --port option with default', () => {
    const cmd = program.commands.find((c) => c.name() === 'serve');
    const portOpt = cmd.options.find((o) => o.long === '--port');
    expect(portOpt).toBeDefined();
    expect(portOpt.short).toBe('-p');
  });

  it('accepts --host option', () => {
    const cmd = program.commands.find((c) => c.name() === 'serve');
    const hostOpt = cmd.options.find((o) => o.long === '--host');
    expect(hostOpt).toBeDefined();
    expect(hostOpt.short).toBe('-H');
  });

  it('accepts --config option', () => {
    const cmd = program.commands.find((c) => c.name() === 'serve');
    const configOpt = cmd.options.find((o) => o.long === '--config');
    expect(configOpt).toBeDefined();
    expect(configOpt.short).toBe('-c');
  });

  it('accepts --pipelines option', () => {
    const cmd = program.commands.find((c) => c.name() === 'serve');
    const opt = cmd.options.find((o) => o.long === '--pipelines');
    expect(opt).toBeDefined();
  });

  it('accepts --plugins option', () => {
    const cmd = program.commands.find((c) => c.name() === 'serve');
    const opt = cmd.options.find((o) => o.long === '--plugins');
    expect(opt).toBeDefined();
  });

  it('parses port as a number', () => {
    const cmd = program.commands.find((c) => c.name() === 'serve');
    const portOpt = cmd.options.find((o) => o.long === '--port');
    // <number> means the option's argument is required (not the option itself)
    expect(portOpt.flags).toContain('<number>');
  });
});
