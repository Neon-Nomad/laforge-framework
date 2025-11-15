import { ModelDefinition, GenerationResult } from '../ast/types.js';
import { computeSchemaDiff, ColumnInfo, SchemaOperation } from './schemaDiff.js';

type MigrationConfig = {
  useSchemas?: boolean;
  previousModels?: ModelDefinition[];
  migrations?: {
    allowDestructive?: boolean;
  };
};

const toSnakeCase = (str: string): string => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');

function renderColumnDefinition(col: ColumnInfo): string {
  let sql = `${col.name} ${col.sqlType}`;
  if (!col.optional) sql += ' NOT NULL';
  if (col.primaryKey) sql += ' PRIMARY KEY';
  if (col.default) sql += ` DEFAULT ${col.default}`;
  return sql;
}

function constraintName(table: string, column: string): string {
  return `fk_${table}_${column}`;
}

function buildStatement(op: SchemaOperation, withSchema: (s: string) => string): string | null {
  switch (op.kind) {
    case 'addTable':
      return `CREATE TABLE IF NOT EXISTS ${withSchema(op.table)} (\n  ${op.columns.map(renderColumnDefinition).join(',\n  ')}\n);`;
    case 'dropTable':
      return `DROP TABLE ${withSchema(op.table)};`;
    case 'renameTable':
      return `ALTER TABLE ${withSchema(op.from)} RENAME TO ${withSchema(op.to)};`;
    case 'addColumn':
      return `ALTER TABLE ${withSchema(op.table)} ADD COLUMN ${renderColumnDefinition(op.column)};`;
    case 'dropColumn':
      return `ALTER TABLE ${withSchema(op.table)} DROP COLUMN ${op.column.name};`;
    case 'renameColumn':
      return `ALTER TABLE ${withSchema(op.table)} RENAME COLUMN ${op.from} TO ${op.to};`;
    case 'alterColumnType':
      return `ALTER TABLE ${withSchema(op.table)} ALTER COLUMN ${op.column} TYPE ${op.to};`;
    case 'alterNullability':
      return op.to === 'not_null'
        ? `ALTER TABLE ${withSchema(op.table)} ALTER COLUMN ${op.column} SET NOT NULL;`
        : `ALTER TABLE ${withSchema(op.table)} ALTER COLUMN ${op.column} DROP NOT NULL;`;
    case 'alterDefault':
      if (op.to) {
        return `ALTER TABLE ${withSchema(op.table)} ALTER COLUMN ${op.column} SET DEFAULT ${op.to};`;
      }
      return `ALTER TABLE ${withSchema(op.table)} ALTER COLUMN ${op.column} DROP DEFAULT;`;
    case 'addForeignKey':
      return `ALTER TABLE ${withSchema(op.fk.table)} ADD CONSTRAINT ${constraintName(op.fk.table, op.fk.column)} FOREIGN KEY (${op.fk.column}) REFERENCES ${withSchema(op.fk.targetTable)}(${op.fk.targetColumn});`;
    case 'dropForeignKey':
      return `ALTER TABLE ${withSchema(op.fk.table)} DROP CONSTRAINT ${constraintName(op.fk.table, op.fk.column)};`;
    case 'alterForeignKey':
      return [
        `ALTER TABLE ${withSchema(op.from.table)} DROP CONSTRAINT ${constraintName(op.from.table, op.from.column)};`,
        `ALTER TABLE ${withSchema(op.to.table)} ADD CONSTRAINT ${constraintName(op.to.table, op.to.column)} FOREIGN KEY (${op.to.column}) REFERENCES ${withSchema(op.to.targetTable)}(${op.to.targetColumn});`,
      ].join('\n');
    default:
      return null;
  }
}

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
  const schemaPrefix = config.useSchemas ? 'public.' : '';
  const withSchema = (name: string) => `${schemaPrefix}${name}`;
  const allowDestructive = config.migrations?.allowDestructive ?? false;
  const previousModels = config.previousModels ?? [];

  const diff = computeSchemaDiff(previousModels, models);
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
    const stmt = buildStatement(op, withSchema);
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
