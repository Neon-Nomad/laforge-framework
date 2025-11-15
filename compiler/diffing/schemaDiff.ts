import type { ModelDefinition, FieldOptions, FieldType, RelationDef } from '../ast/types.js';
import pc from 'picocolors';

export type ColumnInfo = {
  name: string; // snake_case column name
  fieldName: string; // model field name
  type: FieldType;
  sqlType: string;
  optional: boolean;
  default?: string;
  primaryKey?: boolean;
};

export type ForeignKeyInfo = {
  table: string;
  column: string;
  targetTable: string;
  targetColumn: string;
  onDelete?: string;
};

export type SchemaOperation =
  | { kind: 'addTable'; table: string; columns: ColumnInfo[] }
  | { kind: 'dropTable'; table: string; warning: true }
  | { kind: 'renameTable'; from: string; to: string }
  | { kind: 'addColumn'; table: string; column: ColumnInfo }
  | { kind: 'dropColumn'; table: string; column: ColumnInfo; warning: true }
  | { kind: 'renameColumn'; table: string; from: string; to: string }
  | { kind: 'alterColumnType'; table: string; column: string; from: string; to: string }
  | { kind: 'alterNullability'; table: string; column: string; from: 'nullable' | 'not_null'; to: 'nullable' | 'not_null' }
  | { kind: 'alterDefault'; table: string; column: string; from?: string; to?: string }
  | { kind: 'addForeignKey'; fk: ForeignKeyInfo }
  | { kind: 'dropForeignKey'; fk: ForeignKeyInfo; warning?: true }
  | { kind: 'alterForeignKey'; from: ForeignKeyInfo; to: ForeignKeyInfo };

export interface SchemaDiffResult {
  operations: SchemaOperation[];
  warnings: string[];
}

export const schemaDiffJsonSchema = {
  type: 'object',
  properties: {
    operations: { type: 'array' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const toSnakeCase = (str: string): string =>
  str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');

export const mapTypeToSql = (fieldType: FieldType): string => {
  switch (fieldType) {
    case 'uuid':
      return 'UUID';
    case 'string':
      return 'VARCHAR(255)';
    case 'text':
      return 'TEXT';
    case 'integer':
      return 'INTEGER';
    case 'boolean':
      return 'BOOLEAN';
    case 'datetime':
      return 'TIMESTAMP WITH TIME ZONE';
    case 'jsonb':
      return 'JSONB';
    default:
      return 'VARCHAR(255)';
  }
};

function normalizeColumns(model: ModelDefinition): ColumnInfo[] {
  const columns: ColumnInfo[] = [];
  for (const [fieldName, value] of Object.entries(model.schema)) {
    if (typeof value === 'object' && (value as any).__typeName === 'Relation') {
      continue;
    }
    const opts: FieldOptions =
      typeof value === 'object'
        ? (value as FieldOptions)
        : ({ type: value as FieldType } as FieldOptions);
    const name = toSnakeCase(fieldName);
    columns.push({
      name,
      fieldName,
      type: opts.type,
      sqlType: mapTypeToSql(opts.type),
      optional: opts.optional === true,
      default: opts.default,
      primaryKey: opts.primaryKey,
    });
  }
  return columns;
}

function normalizeModels(models: ModelDefinition[]): Map<string, ColumnInfo[]> {
  const tableMap = new Map<string, ColumnInfo[]>();
  for (const model of models) {
    const table = `${toSnakeCase(model.name)}s`;
    tableMap.set(table, normalizeColumns(model));
  }
  return tableMap;
}

function extractPrimaryKey(model: ModelDefinition): string | undefined {
  for (const [fieldName, value] of Object.entries(model.schema)) {
    if (typeof value === 'object' && (value as any).__typeName === 'Relation') continue;
    const opts: FieldOptions = typeof value === 'object' ? (value as FieldOptions) : ({ type: value } as FieldOptions);
    if (opts.primaryKey) return toSnakeCase(fieldName);
  }
  return 'id';
}

function extractForeignKeys(models: ModelDefinition[]): ForeignKeyInfo[] {
  const map = new Map<string, ModelDefinition>();
  models.forEach(m => map.set(m.name, m));

  const fks: ForeignKeyInfo[] = [];
  for (const model of models) {
    const table = `${toSnakeCase(model.name)}s`;
    for (const rel of model.relations) {
      if (rel.type !== 'belongsTo') continue;
      const target = map.get(rel.targetModelName);
      if (!target) continue;
      const targetTable = `${toSnakeCase(target.name)}s`;
      const targetColumn = extractPrimaryKey(target) || 'id';
      fks.push({
        table,
        column: toSnakeCase(rel.foreignKey),
        targetTable,
        targetColumn,
      });
    }
  }
  return fks;
}

function similarityScore(a: ColumnInfo, b: ColumnInfo): number {
  let score = 0;
  if (a.sqlType === b.sqlType) score += 0.4;
  if (!!a.primaryKey === !!b.primaryKey) score += 0.15;
  if (a.optional === b.optional) score += 0.15;
  if (a.default === b.default) score += 0.15;
  if (a.type === b.type) score += 0.15;
  return score;
}

function tableSimilarity(a: ColumnInfo[], b: ColumnInfo[]): number {
  const aNames = new Set(a.map(c => c.name));
  const bNames = new Set(b.map(c => c.name));
  const intersection = [...aNames].filter(n => bNames.has(n)).length;
  const union = new Set([...aNames, ...bNames]).size || 1;
  return intersection / union;
}

export function computeSchemaDiff(oldModels: ModelDefinition[], newModels: ModelDefinition[]): SchemaDiffResult {
  const operations: SchemaOperation[] = [];
  const warnings: string[] = [];

  const oldTables = normalizeModels(oldModels);
  const newTables = normalizeModels(newModels);
  const oldFks = extractForeignKeys(oldModels);
  const newFks = extractForeignKeys(newModels);

  // Table rename detection
  const unmatchedOldTables = new Set(oldTables.keys());
  const unmatchedNewTables = new Set(newTables.keys());
  const tableRenames: Array<{ from: string; to: string }> = [];
  for (const oldName of oldTables.keys()) {
    let best: { name: string; score: number } | null = null;
    for (const newName of newTables.keys()) {
      if (!unmatchedNewTables.has(newName)) continue;
      const score = tableSimilarity(oldTables.get(oldName) || [], newTables.get(newName) || []);
      if (!best || score > best.score) {
        best = { name: newName, score };
      }
    }
    if (best && best.score >= 0.6 && best.name !== oldName) {
      tableRenames.push({ from: oldName, to: best.name });
      unmatchedOldTables.delete(oldName);
      unmatchedNewTables.delete(best.name);
    }
  }
  for (const rename of tableRenames) {
    operations.push({ kind: 'renameTable', from: rename.from, to: rename.to });
  }

  const allTableNames = new Set<string>([
    ...oldTables.keys(),
    ...newTables.keys(),
    ...tableRenames.map(r => r.to),
    ...tableRenames.map(r => r.from),
  ]);

  for (const table of allTableNames) {
    const isRenamedSource = tableRenames.some(r => r.from === table);
    const tableRename = tableRenames.find(r => r.to === table);
    const sourceName = tableRename ? tableRename.from : table;

    const oldCols = oldTables.get(sourceName);
    const newCols = newTables.get(table);

    if (!oldCols && newCols) {
      operations.push({ kind: 'addTable', table, columns: newCols });
      continue;
    }
    if (oldCols && !newCols) {
      if (isRenamedSource) {
        continue;
      }
      operations.push({ kind: 'dropTable', table, warning: true });
      warnings.push(`Table dropped: ${table}`);
      continue;
    }
    if (!oldCols || !newCols) continue;

    const oldByName = new Map(oldCols.map(c => [c.name, c]));
    const newByName = new Map(newCols.map(c => [c.name, c]));

    const removed = oldCols.filter(c => !newByName.has(c.name));
    const added = newCols.filter(c => !oldByName.has(c.name));

    // Improved rename detection by similarity
    const matchedAdds = new Set<string>();
    for (const removedCol of removed) {
      let best: { candidate: ColumnInfo | null; score: number } = { candidate: null, score: 0 };
      for (const addCol of added) {
        if (matchedAdds.has(addCol.name)) continue;
        const score = similarityScore(removedCol, addCol);
        if (score > best.score) {
          best = { candidate: addCol, score };
        }
      }
      if (best.candidate && best.score >= 0.75) {
        operations.push({ kind: 'renameColumn', table, from: removedCol.name, to: best.candidate.name });
        matchedAdds.add(best.candidate.name);
      }
    }

    for (const addedCol of added) {
      if (matchedAdds.has(addedCol.name)) continue;
      operations.push({ kind: 'addColumn', table, column: addedCol });
    }

    for (const removedCol of removed) {
      const wasRenamed = [...operations].some(op => op.kind === 'renameColumn' && op.table === table && op.from === removedCol.name);
      if (wasRenamed) continue;
      operations.push({ kind: 'dropColumn', table, column: removedCol, warning: true });
      warnings.push(`Column dropped: ${table}.${removedCol.name}`);
    }

    const shared = oldCols.filter(c => newByName.has(c.name));
    for (const oldCol of shared) {
      const newCol = newByName.get(oldCol.name)!;

      if (oldCol.sqlType !== newCol.sqlType) {
        operations.push({
          kind: 'alterColumnType',
          table,
          column: oldCol.name,
          from: oldCol.sqlType,
          to: newCol.sqlType,
        });
      }

      if (oldCol.optional !== newCol.optional) {
        operations.push({
          kind: 'alterNullability',
          table,
          column: oldCol.name,
          from: oldCol.optional ? 'nullable' : 'not_null',
          to: newCol.optional ? 'nullable' : 'not_null',
        });
      }

      if (oldCol.default !== newCol.default) {
        operations.push({
          kind: 'alterDefault',
          table,
          column: oldCol.name,
          from: oldCol.default,
          to: newCol.default,
        });
      }
    }
  }

  // Foreign key diffing
  const fkKey = (fk: ForeignKeyInfo) => `${fk.table}.${fk.column}->${fk.targetTable}.${fk.targetColumn}`;
  const oldFkMap = new Map(oldFks.map(fk => [fkKey(fk), fk]));
  const newFkMap = new Map(newFks.map(fk => [fkKey(fk), fk]));

  for (const [key, fk] of newFkMap) {
    if (!oldFkMap.has(key)) {
      // detect potential changed fk by same table/column
      const alteredFrom = oldFks.find(o => o.table === fk.table && o.column === fk.column);
      if (alteredFrom) {
        operations.push({ kind: 'alterForeignKey', from: alteredFrom, to: fk });
      } else {
        operations.push({ kind: 'addForeignKey', fk });
      }
    }
  }
  for (const [key, fk] of oldFkMap) {
    if (!newFkMap.has(key)) {
      operations.push({ kind: 'dropForeignKey', fk, warning: true });
      warnings.push(`Foreign key dropped: ${fk.table}.${fk.column} -> ${fk.targetTable}.${fk.targetColumn}`);
    }
  }

  return { operations, warnings };
}

export function formatSchemaDiff(diff: SchemaDiffResult, opts: { colors?: boolean } = {}): string {
  if (diff.operations.length === 0) {
    return 'No schema changes detected.';
  }

  const colorize = (line: string) => {
    if (!opts.colors) return line;
    if (line.startsWith('+')) return pc.green(line);
    if (line.startsWith('~') && line.includes('rename')) return pc.yellow(line);
    if (line.startsWith('~')) return pc.blue(line);
    if (line.startsWith('!')) return pc.red(line);
    return line;
  };

  return diff.operations
    .map(op => {
      switch (op.kind) {
        case 'addTable':
          return colorize(`+ add table ${op.table} (${op.columns.map(c => `${c.name} ${c.sqlType}`).join(', ')})`);
        case 'dropTable':
          return colorize(`! drop table ${op.table}`);
        case 'renameTable':
          return colorize(`~ rename table ${op.from} -> ${op.to}`);
        case 'addColumn':
          return colorize(`+ add column ${op.table}.${op.column.name} ${op.column.sqlType}${op.column.optional ? '' : ' NOT NULL'}`);
        case 'dropColumn':
          return colorize(`! drop column ${op.table}.${op.column.name}`);
        case 'renameColumn':
          return colorize(`~ rename column ${op.table}.${op.from} -> ${op.to}`);
        case 'alterColumnType':
          return colorize(`~ alter type ${op.table}.${op.column}: ${op.from} -> ${op.to}`);
        case 'alterNullability':
          return colorize(`~ alter nullability ${op.table}.${op.column}: ${op.from} -> ${op.to}`);
        case 'alterDefault':
          return colorize(`~ alter default ${op.table}.${op.column}: ${op.from ?? 'NULL'} -> ${op.to ?? 'NULL'}`);
        case 'addForeignKey':
          return colorize(`+ add FK ${op.fk.table}.${op.fk.column} -> ${op.fk.targetTable}.${op.fk.targetColumn}`);
        case 'dropForeignKey':
          return colorize(`! drop FK ${op.fk.table}.${op.fk.column}`);
        case 'alterForeignKey':
          return colorize(`~ alter FK ${op.from.table}.${op.from.column} -> ${op.to.targetTable}.${op.to.targetColumn}`);
        default:
          return colorize('? unknown change');
      }
    })
    .join('\n');
}
