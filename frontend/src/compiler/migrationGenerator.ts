
import { ModelDefinition, FieldOptions, FieldType } from './types';
import { GenerationResult } from './types';

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');
}

// FIX: Add missing toCamelCase helper function.
function toCamelCase(str: string): string {
    const pascal = str.replace(/(?:^|-|_)(\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, '');
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function mapTypeToSql(fieldType: FieldType): string {
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
}

function generateFieldSql(name: string, options: FieldOptions | FieldType): string {
    const fieldName = toSnakeCase(name);
    const opts = typeof options === 'object' ? options : { type: options };
    
    let sql = `${fieldName} ${mapTypeToSql(opts.type)}`;

    if (opts.primaryKey) {
        sql += ' PRIMARY KEY';
    }
    if (opts.optional === false || opts.optional === undefined) {
        sql += ' NOT NULL';
    }
    if (opts.default) {
        sql += ` DEFAULT ${opts.default}`;
    }

    return sql;
}

export function generateMigrations(
  models: ModelDefinition[],
  config: { useSchemas?: boolean } = {}
): GenerationResult[] {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 14);

  let mainTablesSql = '';
  let constraintSql = '';
  let joinTablesSql = '';
  const processedManyToMany = new Set<string>();
  const schemaPrefix = config.useSchemas ? 'public.' : '';
  const withSchema = (name: string) => `${schemaPrefix}${name}`;

  for (const model of models) {
    const tableName = toSnakeCase(model.name) + 's';
    const fields = Object.entries(model.schema)
      .filter(([, value]) => value && !(typeof value === 'object' && (value as any).__typeName === 'Relation')) // filter out relations
      .map(([name, options]) => `  ${generateFieldSql(name, options as FieldType | FieldOptions)}`)
      .join(',\n');
    
    mainTablesSql += `
CREATE TABLE IF NOT EXISTS ${withSchema(tableName)} (
${fields}
);
`;

    // --- Process relations for constraints and join tables ---
    for (const rel of model.relations) {
        if (rel.type === 'belongsTo') {
            const targetModel = models.find(m => m.name === rel.targetModelName);
            if (targetModel) {
                const targetTableName = toSnakeCase(targetModel.name) + 's';
                const targetPk = Object.keys(targetModel.schema).find(f => {
                    const opts = targetModel.schema[f];
                    // FIX: Add a robust check to prevent crash on null/relation schema values.
                    return typeof opts === 'object' && opts && !(opts as any).__typeName && (opts as any).primaryKey;
                }) || 'id';
                constraintSql += `
ALTER TABLE ${withSchema(tableName)} ADD CONSTRAINT fk_${tableName}_${toSnakeCase(rel.foreignKey)}
  FOREIGN KEY (${toSnakeCase(rel.foreignKey)}) REFERENCES ${withSchema(targetTableName)}(${toSnakeCase(targetPk)}) ON DELETE SET NULL;
`;
            }
        } else if (rel.type === 'manyToMany' && rel.through) {
            if (processedManyToMany.has(rel.through)) continue;
            processedManyToMany.add(rel.through);

            const targetModel = models.find(m => m.name === rel.targetModelName);
            if (targetModel) {
                 const targetTableName = toSnakeCase(targetModel.name) + 's';
                 const thisFk = toSnakeCase(rel.foreignKey);
                 const otherFk = toSnakeCase(`${toCamelCase(rel.targetModelName)}Id`);

                 // FIX: Robustly find the primary key for both tables instead of hardcoding 'id'.
                 const thisPkField = Object.keys(model.schema).find(f => {
                    const opts = model.schema[f];
                    return typeof opts === 'object' && opts && !(opts as any).__typeName && (opts as any).primaryKey;
                 }) || 'id';

                 const targetPkField = Object.keys(targetModel.schema).find(f => {
                    const opts = targetModel.schema[f];
                    return typeof opts === 'object' && opts && !(opts as any).__typeName && (opts as any).primaryKey;
                 }) || 'id';

                 joinTablesSql += `
CREATE TABLE IF NOT EXISTS ${withSchema(rel.through)} (
    ${thisFk} UUID NOT NULL,
    ${otherFk} UUID NOT NULL,
    PRIMARY KEY (${thisFk}, ${otherFk}),
    FOREIGN KEY (${thisFk}) REFERENCES ${withSchema(tableName)}(${toSnakeCase(thisPkField)}) ON DELETE CASCADE,
    FOREIGN KEY (${otherFk}) REFERENCES ${withSchema(targetTableName)}(${toSnakeCase(targetPkField)}) ON DELETE CASCADE
);
`;
            }
        }
    }
  }

  const content = `
-- Forge migration generated at ${new Date().toUTCString()}

-- Create Tables
${mainTablesSql}

-- Create Join Tables
${joinTablesSql}

-- Add Foreign Key Constraints
${constraintSql}
`;

  return [{
    filePath: `migrations/${timestamp}_initial_schema.sql`,
    content,
  }];
}
