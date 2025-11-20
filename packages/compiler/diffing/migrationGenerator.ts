import { ModelDefinition, GenerationResult, SupportedDb } from '../ast/types.js';
import { computeSchemaDiff, ColumnInfo, SchemaOperation } from './schemaDiff.js';
import { getAdapter } from '../sql/adapters.js';

type MigrationConfig = {
  useSchemas?: boolean;
  previousModels?: ModelDefinition[];
  db?: SupportedDb;
  migrations?: {
    allowDestructive?: boolean;
  };
};

function isDestructive(op: SchemaOperation): boolean {
  return (
    op.kind === 'dropTable' ||
    op.kind === 'dropColumn' ||
    op.kind === 'dropForeignKey' ||
    op.kind === 'alterColumnType'
  );
}

function fallbackStatementsFor(
  op: SchemaOperation,
  withSchema: (name: string) => string,
  db: SupportedDb,
): string[] {
  const tableRef = 'table' in op ? withSchema(op.table) : '';
  switch (op.kind) {
    case 'dropTable': {
      return [
        `-- Fallback for dropping table ${op.table}: rename instead to keep data`,
        `ALTER TABLE ${tableRef} RENAME TO ${op.table}_deprecated;`,
      ];
    }
    case 'dropColumn': {
      const colName = op.column.name;
      return [
        `-- Fallback for dropping column ${op.table}.${colName}: rename instead of destructive drop`,
        `ALTER TABLE ${tableRef} RENAME COLUMN ${colName} TO ${colName}_deprecated;`,
      ];
    }
    case 'alterColumnType': {
      const copyColumn = `${op.column}_shadow`;
      return [
        `-- Fallback for altering ${op.table}.${op.column} type. Copy data to a shadow column for manual migration.`,
        `ALTER TABLE ${tableRef} ADD COLUMN ${copyColumn} ${op.to};`,
        `UPDATE ${tableRef} SET ${copyColumn} = ${op.column};`,
        `-- Once data is verified, consider swapping ${op.column} with ${copyColumn} and dropping the original column manually.`,
      ];
    }
    case 'dropForeignKey': {
      const fk = op.fk;
      return [
        `-- Fallback for dropping foreign key ${fk.table}.${fk.column}.`,
        `-- Consider disabling the constraint manually only after auditing dependent data.`,
      ];
    }
    default:
      return [
        `-- Fallback placeholder for ${op.kind}. Manual intervention required.`,
      ];
  }
}

export function generateMigrations(
  models: ModelDefinition[],
  config: MigrationConfig = {}
): GenerationResult[] {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 14);
  const db = config.db || 'postgres';
  const adapter = getAdapter(db);
  const schemaPrefix = config.useSchemas ? (db === 'postgres' ? 'public.' : '') : '';
  const withSchema = (name: string) => `${schemaPrefix}${name}`;
  const allowDestructive = config.migrations?.allowDestructive ?? false;
  const previousModels = config.previousModels ?? [];

  const diff = computeSchemaDiff(previousModels, models, db);
  const statements: string[] = [];
  const skipped: string[] = [...diff.warnings];
  const fallbackStatements: string[] = [];

  const describeOp = (op: SchemaOperation): string => {
    switch (op.kind) {
      case 'dropTable':
      case 'addTable':
        return `${op.kind} ${op.table}`;
      case 'renameTable':
        return `${op.kind} ${op.from} -> ${op.to}`;
      case 'dropColumn':
      case 'addColumn':
      case 'renameColumn':
      case 'alterColumnType':
      case 'alterNullability':
      case 'alterDefault':
        return `${op.kind} ${op.table}.${'column' in op ? (op as any).column : 'from' in op ? op.from : ''}`;
      case 'dropForeignKey':
      case 'addForeignKey':
        return `${op.kind} ${op.fk.table}.${op.fk.column}`;
      case 'alterForeignKey':
        return `${op.kind} ${op.from.table}.${op.from.column}`;
      default:
        return (op as any).kind ?? 'unknown';
    }
  };

  for (const op of diff.operations) {
    if (isDestructive(op) && !allowDestructive) {
      skipped.push(`Destructive change skipped: ${describeOp(op)}`);
      fallbackStatements.push(...fallbackStatementsFor(op, withSchema, db));
      continue;
    }
    const stmt = adapter.render(op, withSchema);
    if (stmt) {
      statements.push(stmt);
    }
  }

  const warningsBlock =
    skipped.length > 0
      ? skipped.map(w => `-- WARNING: ${w}`).join('\n') + '\n'
      : '';

  const content = `-- Forge migration generated at ${new Date().toUTCString()}
${warningsBlock}${statements.join('\n')}
`;

  const results: GenerationResult[] = [
    {
      filePath: `migrations/${timestamp}_schema.sql`,
      content,
    },
  ];

  if (fallbackStatements.length > 0) {
    const fallbackContent = `-- WARNING: Destructive changes were skipped in safe mode. Review and apply manually.
-- Non-destructive fallbacks generated at ${new Date().toUTCString()}
-- These statements keep data while you plan the destructive change.
${fallbackStatements.join('\n')}
`;
    results.push({
      filePath: `migrations/${timestamp}_fallback.sql`,
      content: fallbackContent,
    });
  }

  return results;
}
