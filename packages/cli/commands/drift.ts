import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectDrift } from '../../runtime/drift.js';
import { DatabaseConnection } from '../../runtime/db/database.js';
import type { CompilationOutput } from '../../compiler/index.js';

export function registerDriftCommand(program: Command) {
  program
    .command('drift')
    .description('Detect schema drift between compiled models and the database')
    .option('--compiled <path>', 'Path to compiled.json', path.join('generated', 'compiled.json'))
    .option('--db <path>', 'SQLite database path', path.join('.laforge', 'history', 'replay.db'))
    .action(async (opts: { compiled?: string; db?: string }) => {
      const compiledPath = path.resolve(opts.compiled || path.join('generated', 'compiled.json'));
      const dbPath = opts.db || path.join('.laforge', 'history', 'replay.db');
      let compiled: CompilationOutput;
      try {
        compiled = JSON.parse(await fs.readFile(compiledPath, 'utf8')) as CompilationOutput;
      } catch (err: any) {
        console.error(`Failed to read compiled output at ${compiledPath}: ${err.message}`);
        process.exitCode = 1;
        return;
      }

      const db = new DatabaseConnection(dbPath);
      const drift = await detectDrift(db, compiled);
      const result = { compiled: compiledPath, db: dbPath, drift };
      console.log(JSON.stringify(result, null, 2));
      if (drift.length) {
        process.exitCode = 1;
      }
    });
}
