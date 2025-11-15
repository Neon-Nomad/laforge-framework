import { Command } from 'commander';
import { compileForSandbox } from '../../compiler/index.js';
import { diffSql } from '../../compiler/diffing/sqlDiff.js';
import { computeSchemaDiff, formatSchemaDiff } from '../../compiler/diffing/schemaDiff.js';
import { readDomainFile } from './utils.js';

export function registerDiffCommand(program: Command) {
  program
    .command('diff <oldDomain> <newDomain>')
    .description('Show SQL diff between two domain definitions')
    .option('--json', 'output JSON for CI/automation')
    .action(async (oldDomain: string, newDomain: string, options: { json?: boolean }) => {
      try {
        const oldSource = await readDomainFile(oldDomain);
        const newSource = await readDomainFile(newDomain);

        const oldOutput = compileForSandbox(oldSource.content);
        const newOutput = compileForSandbox(newSource.content);

        const schemaDiff = computeSchemaDiff(oldOutput.models, newOutput.models);
        const diff = diffSql(oldOutput.sql, newOutput.sql);

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                schema: schemaDiff,
                sqlDiff: diff.trim() || '',
              },
              null,
              2
            )
          );
          return;
        }

        console.log('Schema changes:');
        console.log(formatSchemaDiff(schemaDiff, { colors: true }));

        if (diff.trim()) {
          console.log('\nSQL diff:');
          console.log(diff);
        } else {
          console.log('\nNo SQL text differences detected.');
        }
      } catch (error: any) {
        console.error('Diff failed:', error.message);
        process.exitCode = 1;
      }
    });
}
