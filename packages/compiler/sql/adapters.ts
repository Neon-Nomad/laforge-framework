import type { ColumnInfo, SchemaOperation } from '../diffing/schemaDiff.js';
import type { SupportedDb } from '../ast/types.js';

export interface SqlAdapter {
  name: SupportedDb;
  render(op: SchemaOperation, withSchema: (name: string) => string): string | null;
}

function renderColumn(col: ColumnInfo): string {
  let sql = `${col.name} ${col.sqlType}`;
  if (!col.optional) sql += ' NOT NULL';
  if (col.primaryKey) sql += ' PRIMARY KEY';
  if (col.default) sql += ` DEFAULT ${col.default}`;
  if (col.unique) sql += ' UNIQUE';
  return sql;
}

const constraintName = (table: string, column: string) => `fk_${table}_${column}`;

function baseRender(op: SchemaOperation, withSchema: (name: string) => string, opts: { dropColumnSupportsCascade?: boolean } = {}): string | null {
  switch (op.kind) {
    case 'addTable':
      return `CREATE TABLE IF NOT EXISTS ${withSchema(op.table)} (\n  ${op.columns.map(renderColumn).join(',\n  ')}\n);`;
    case 'dropTable':
      return `DROP TABLE ${withSchema(op.table)};`;
    case 'renameTable':
      return `ALTER TABLE ${withSchema(op.from)} RENAME TO ${withSchema(op.to)};`;
    case 'addColumn':
      return `ALTER TABLE ${withSchema(op.table)} ADD COLUMN ${renderColumn(op.column)};`;
    case 'dropColumn':
      return `ALTER TABLE ${withSchema(op.table)} DROP COLUMN ${op.column.name}${opts.dropColumnSupportsCascade ? '' : ''};`;
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
      return `ALTER TABLE ${withSchema(op.fk.table)} ADD CONSTRAINT ${constraintName(op.fk.table, op.fk.column)} FOREIGN KEY (${op.fk.column}) REFERENCES ${withSchema(op.fk.targetTable)}(${op.fk.targetColumn})${op.fk.onDelete ? ` ON DELETE ${op.fk.onDelete.toUpperCase()}` : ''};`;
    case 'dropForeignKey':
      return `ALTER TABLE ${withSchema(op.fk.table)} DROP CONSTRAINT ${constraintName(op.fk.table, op.fk.column)};`;
    case 'alterForeignKey':
      return [
        `ALTER TABLE ${withSchema(op.from.table)} DROP CONSTRAINT ${constraintName(op.from.table, op.from.column)};`,
        `ALTER TABLE ${withSchema(op.to.table)} ADD CONSTRAINT ${constraintName(op.to.table, op.to.column)} FOREIGN KEY (${op.to.column}) REFERENCES ${withSchema(op.to.targetTable)}(${op.to.targetColumn})${op.to.onDelete ? ` ON DELETE ${op.to.onDelete.toUpperCase()}` : ''};`,
      ].join('\n');
    default:
      return null;
  }
}

const postgresAdapter: SqlAdapter = {
  name: 'postgres',
  render: (op, withSchema) => baseRender(op, withSchema),
};

const sqliteAdapter: SqlAdapter = {
  name: 'sqlite',
  render: (op, withSchema) => {
    if (op.kind === 'dropForeignKey' || op.kind === 'alterForeignKey') {
      // SQLite FK alterations are limited; skip for now.
      return null;
    }
    return baseRender(op, withSchema);
  },
};

const mysqlAdapter: SqlAdapter = {
  name: 'mysql',
  render: (op, withSchema) => {
    if (op.kind === 'renameColumn') {
      // MySQL 8+ supports RENAME COLUMN
      return `ALTER TABLE ${withSchema(op.table)} RENAME COLUMN ${op.from} TO ${op.to};`;
    }
    if (op.kind === 'alterColumnType') {
      return `ALTER TABLE ${withSchema(op.table)} MODIFY ${op.column} ${op.to};`;
    }
    if (op.kind === 'dropForeignKey') {
      return `ALTER TABLE ${withSchema(op.fk.table)} DROP FOREIGN KEY ${constraintName(op.fk.table, op.fk.column)};`;
    }
    if (op.kind === 'addForeignKey') {
      return `ALTER TABLE ${withSchema(op.fk.table)} ADD CONSTRAINT ${constraintName(op.fk.table, op.fk.column)} FOREIGN KEY (${op.fk.column}) REFERENCES ${withSchema(op.fk.targetTable)}(${op.fk.targetColumn});`;
    }
    return baseRender(op, withSchema);
  },
};

export function getAdapter(db: SupportedDb): SqlAdapter {
  if (db === 'mysql') return mysqlAdapter;
  if (db === 'sqlite') return sqliteAdapter;
  return postgresAdapter;
}
