import type { CompilationOutput } from '../compiler/index.js';
import type { ModelDefinition } from '../compiler/ast/types.js';
import type { DatabaseConnection } from './db/database.js';

interface DriftDiff {
  table: string;
  missingColumns: string[];
  extraColumns: string[];
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');
}

function expectedColumns(model: ModelDefinition): string[] {
  return Object.keys(model.schema)
    .filter(key => {
      const val = model.schema[key] as any;
      return !(val && typeof val === 'object' && val.__typeName === 'Relation');
    })
    .map(toSnakeCase);
}

async function readActualColumns(db: DatabaseConnection, table: string): Promise<string[]> {
  try {
    const res = await db.query(`PRAGMA table_info("${table}")`);
    return res.rows.map((r: any) => String(r.name));
  } catch {
    return [];
  }
}

export async function detectDrift(db: DatabaseConnection, compiled: CompilationOutput): Promise<DriftDiff[]> {
  const diffs: DriftDiff[] = [];
  for (const model of compiled.models) {
    const table = `${toSnakeCase(model.name)}s`;
    const expected = expectedColumns(model);
    const actual = await readActualColumns(db, table);
    if (!actual.length) {
      diffs.push({ table, missingColumns: expected, extraColumns: [] });
      continue;
    }
    const missingColumns = expected.filter(col => !actual.includes(col));
    const extraColumns = actual.filter(col => !expected.includes(col));
    if (missingColumns.length || extraColumns.length) {
      diffs.push({ table, missingColumns, extraColumns });
    }
  }
  return diffs;
}
