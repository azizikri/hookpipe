#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import dotenv from 'dotenv';
import { serveCommand } from './serve.js';
import { replayCommand } from './replay.js';
import { testCommand } from './test.js';
import { logsCommand } from './logs.js';
dotenv.config();

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

const program = new Command();

program
  .name('hookpipe')
  .description('Webhook ingestion and delivery pipeline')
  .version(pkg.version);

// Register commands
serveCommand(program);

testCommand(program);

logsCommand(program);

replayCommand(program);

program.parse();
