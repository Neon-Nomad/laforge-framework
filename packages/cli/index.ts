#!/usr/bin/env node
import { Command } from 'commander';
import { registerCompileCommand } from './commands/compile.js';
import { registerGenerateCommand } from './commands/generate.js';
import { registerTestCommand } from './commands/test.js';
import { registerDiffCommand } from './commands/diff.js';
import { registerMigrateCommand } from './commands/migrate.js';
import { registerStatusCommand } from './commands/status.js';
import { registerStudioCommand } from './commands/studio.js';
import { registerTimelineCommand } from './commands/timeline.js';
import { registerAuditCommand } from './commands/audit.js';
import { registerSignCommand } from './commands/sign.js';
import { registerVerifyCommand } from './commands/verify.js';
import { registerApprovalCommands } from './commands/approval.js';
import { registerDeployCommand } from './commands/deploy.js';
import { registerExportCommand } from './commands/export.js';
import { registerRollbackCommand } from './commands/rollback.js';
import { registerDriftCommand } from './commands/drift.js';
import { registerKmsCommand } from './commands/kms.js';

const program = new Command();

program
  .name('laforge')
  .description('LaForge CLI - policy-first backend compiler')
  .version('1.3.0');

registerCompileCommand(program);
registerGenerateCommand(program);
registerTestCommand(program);
registerDiffCommand(program);
registerMigrateCommand(program);
registerStatusCommand(program);
registerStudioCommand(program);
registerTimelineCommand(program);
registerAuditCommand(program);
registerSignCommand(program);
registerVerifyCommand(program);
registerApprovalCommands(program);
registerDeployCommand(program);
registerExportCommand(program);
registerRollbackCommand(program);
registerDriftCommand(program);
registerKmsCommand(program);

program.parseAsync(process.argv);
