import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { replayCommand } from '../../src/cli/replay.js';

describe('CLI replay command', () => {
  let program;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    replayCommand(program);
  });

  it('registers replay command with correct name', () => {
    const cmd = program.commands.find((c) => c.name() === 'replay');
    expect(cmd).toBeDefined();
  });

  it('requires delivery-id argument', () => {
    const cmd = program.commands.find((c) => c.name() === 'replay');
    const args = cmd.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].required).toBe(true);
    expect(args[0].name()).toBe('delivery-id');
  });

  it('has --dry-run option', () => {
    const cmd = program.commands.find((c) => c.name() === 'replay');
    const opt = cmd.options.find((o) => o.long === '--dry-run');
    expect(opt).toBeDefined();
  });

  it('has -c, --config option', () => {
    const cmd = program.commands.find((c) => c.name() === 'replay');
    const opt = cmd.options.find((o) => o.long === '--config');
    expect(opt).toBeDefined();
    expect(opt.short).toBe('-c');
  });
});
