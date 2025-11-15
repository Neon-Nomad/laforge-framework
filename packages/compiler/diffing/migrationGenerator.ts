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

  return [{
    filePath: `migrations/${timestamp}_schema.sql`,
    content,
  }];
}
