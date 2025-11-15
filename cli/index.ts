#!/usr/bin/env node
import { Command } from 'commander';
import { registerCompileCommand } from './commands/compile.js';
import { registerGenerateCommand } from './commands/generate.js';
import { registerTestCommand } from './commands/test.js';
import { registerDiffCommand } from './commands/diff.js';

const program = new Command();

program
  .name('forge')
  .description('LaForge CLI - policy-first backend compiler')
  .version('1.0.0');

registerCompileCommand(program);
registerGenerateCommand(program);
registerTestCommand(program);
registerDiffCommand(program);

program.parseAsync(process.argv);
