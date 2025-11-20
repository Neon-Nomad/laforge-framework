import { ClassifiedError } from '../contract.js';

const DEFAULT_TABLE = 'auto_migrate_placeholder';
const DEFAULT_COLUMN = 'auto_column';

export function repairMigration(originalSql: string, errors: ClassifiedError[]): string {
  if (errors.length === 0) {
    return originalSql;
  }

  let body = normalizeSql(originalSql);
  const prelude: string[] = [];
  const appendStatements: string[] = [];

  let dropBlocked = false;
  let reorderForeignKeys = false;
  let wrapWithGuard = false;

  for (const error of errors) {
    switch (error.kind) {
      case 'missing_table': {
        const table = quoteIdentifier(error.table ?? inferTableFromMessage(error.message));
        prelude.push(
          [
            `-- Auto-migrate: create missing table ${table}`,
            `CREATE TABLE IF NOT EXISTS ${table} (`,
            `  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),`,
            `  created_at timestamptz DEFAULT now(),`,
            `  updated_at timestamptz DEFAULT now()`,
            `);`,
          ].join('\n'),
        );
        break;
      }
      case 'missing_column': {
        const table = quoteIdentifier(error.table ?? inferTableFromMessage(error.message));
        const column = quoteIdentifier(error.column ?? inferColumnFromMessage(error.message), DEFAULT_COLUMN);
        const columnType = mapColumnType(error.expectedType);
        appendStatements.push(
          `-- Auto-migrate: append missing column ${column} on ${table}\nALTER TABLE IF EXISTS ${table} ADD COLUMN IF NOT EXISTS ${column} ${columnType};`,
        );
        break;
      }
      case 'foreign_key': {
        reorderForeignKeys = true;
        break;
      }
      case 'type_mismatch': {
        const table = quoteIdentifier(error.table ?? inferTableFromMessage(error.message));
        const column = quoteIdentifier(error.column ?? inferColumnFromMessage(error.message), DEFAULT_COLUMN);
        const type = mapColumnType(error.expectedType);
        appendStatements.push(
          [
            `-- Auto-migrate: adjust column type for ${table}.${column}`,
            `ALTER TABLE IF EXISTS ${table}`,
            `  ALTER COLUMN ${column} TYPE ${type} USING ${column}::${type};`,
          ].join('\n'),
        );
        break;
      }
      case 'invalid_default': {
        const table = quoteIdentifier(error.table ?? inferTableFromMessage(error.message));
        const column = quoteIdentifier(error.column ?? inferColumnFromMessage(error.message), DEFAULT_COLUMN);
        appendStatements.push(
          `-- Auto-migrate: reset invalid default for ${table}.${column}\nALTER TABLE IF EXISTS ${table} ALTER COLUMN ${column} DROP DEFAULT;`,
        );
        break;
      }
      case 'drop_blocked': {
        dropBlocked = true;
        break;
      }
      case 'unknown': {
        wrapWithGuard = true;
        break;
      }
    }
  }

  if (dropBlocked) {
    body = commentOutDrops(body);
  }

  if (reorderForeignKeys) {
    body = reorderForeignKeyStatements(body);
  }

  let finalSql = [prelude.filter(Boolean).join('\n\n'), body, appendStatements.filter(Boolean).join('\n\n')]
    .filter((section) => section && section.trim().length > 0)
    .join('\n\n');

  if (wrapWithGuard) {
    finalSql = wrapWithTransaction(finalSql);
  }

  return `${finalSql.trim()}\n`;
}

function normalizeSql(sql: string): string {
  return sql.trim();
}

function quoteIdentifier(value?: string, fallback = DEFAULT_TABLE): string {
  const safeValue = (value && value.length > 0 ? value : fallback).replace(/"/g, '""');
  return `"${safeValue}"`;
}

function inferTableFromMessage(message?: string): string {
  if (!message) {
    return DEFAULT_TABLE;
  }

  const relationMatch = /relation "(?<table>[^"]+)"/i.exec(message);
  if (relationMatch?.groups?.table) {
    return relationMatch.groups.table;
  }

  const tableMatch = /table "(?<table>[^"]+)"/i.exec(message);
  if (tableMatch?.groups?.table) {
    return tableMatch.groups.table;
  }

  return DEFAULT_TABLE;
}

function inferColumnFromMessage(message?: string): string {
  if (!message) {
    return DEFAULT_COLUMN;
  }

  const columnMatch = /column "(?<column>[^"]+)"/i.exec(message);
  if (columnMatch?.groups?.column) {
    return columnMatch.groups.column;
  }

  return DEFAULT_COLUMN;
}

function mapColumnType(typeHint?: string): string {
  if (!typeHint) return 'text';

  const normalized = typeHint.trim().toLowerCase();
  if (normalized.includes('uuid')) return 'uuid';
  if (normalized.includes('int')) return 'integer';
  if (normalized.includes('bool')) return 'boolean';
  if (normalized.includes('json')) return 'jsonb';
  if (normalized.includes('timestamp') || normalized.includes('date')) return 'timestamptz';
  if (normalized.includes('numeric') || normalized.includes('decimal')) return 'numeric';

  return 'text';
}

function commentOutDrops(sql: string): string {
  return sql.replace(/^\s*(DROP\s+[^;]+;)/gim, (statement) => `-- Auto-migrate disabled: ${statement}`);
}

function reorderForeignKeyStatements(sql: string): string {
  const statements = splitStatements(sql);
  const fkStatements: string[] = [];
  const otherStatements: string[] = [];

  for (const statement of statements) {
    if (/foreign\s+key/i.test(statement)) {
      fkStatements.push(statement);
    } else {
      otherStatements.push(statement);
    }
  }

  return [...otherStatements, ...fkStatements].filter(Boolean).map(ensureSemicolon).join('\n\n');
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n?/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function ensureSemicolon(statement: string): string {
  return statement.endsWith(';') ? statement : `${statement};`;
}

function wrapWithTransaction(sql: string): string {
  const indented = sql
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  return [
    'DO $$',
    'BEGIN',
    '  SAVEPOINT auto_migrate_guard;',
    indented,
    '  RELEASE SAVEPOINT auto_migrate_guard;',
    'EXCEPTION WHEN OTHERS THEN',
    '  ROLLBACK TO SAVEPOINT auto_migrate_guard;',
    "  RAISE NOTICE 'Auto-migrate fallback triggered: %', SQLERRM;",
    'END;',
    '$$;',
  ].join('\n');
}
