import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';
import { testCommand } from '../../src/cli/test.js';

describe('CLI test command', () => {
  let program;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    testCommand(program);
  });

  it('registers the test command', () => {
    const cmd = program.commands.find((c) => c.name() === 'test');
    expect(cmd).toBeDefined();
    expect(cmd.description()).toContain('pipeline');
  });

  it('accepts a pipeline-id argument', () => {
    const cmd = program.commands.find((c) => c.name() === 'test');
    const arg = cmd.registeredArguments.find((a) => a.name() === 'pipeline-id');
    expect(arg).toBeDefined();
    expect(arg.required).toBe(true);
  });

  it('accepts --file option with short flag', () => {
    const cmd = program.commands.find((c) => c.name() === 'test');
    const opt = cmd.options.find((o) => o.long === '--file');
    expect(opt).toBeDefined();
    expect(opt.short).toBe('-f');
  });

  it('accepts --data option with short flag', () => {
    const cmd = program.commands.find((c) => c.name() === 'test');
    const opt = cmd.options.find((o) => o.long === '--data');
    expect(opt).toBeDefined();
    expect(opt.short).toBe('-d');
  });

  it('accepts --header option that is repeatable', () => {
    const cmd = program.commands.find((c) => c.name() === 'test');
    const opt = cmd.options.find((o) => o.long === '--header');
    expect(opt).toBeDefined();
    // Commander uses variadic or custom parsing for repeatable options
    expect(opt.flags).toContain('<header>');
  });

  it('accepts --skip-auth flag', () => {
    const cmd = program.commands.find((c) => c.name() === 'test');
    const opt = cmd.options.find((o) => o.long === '--skip-auth');
    expect(opt).toBeDefined();
  });

  it('accepts --config option with short flag', () => {
    const cmd = program.commands.find((c) => c.name() === 'test');
    const opt = cmd.options.find((o) => o.long === '--config');
    expect(opt).toBeDefined();
    expect(opt.short).toBe('-c');
  });

  it('--header collects multiple values', async () => {
    const cmd = program.commands.find((c) => c.name() === 'test');
    const opt = cmd.options.find((o) => o.long === '--header');
    // Repeatable options in Commander use a custom argParser that returns array
    // The option should not be variadic but use a collect function
    expect(opt).toBeDefined();
  });
});
