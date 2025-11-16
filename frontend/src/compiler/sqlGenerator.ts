
import { ModelDefinition } from './types';
import { GenerationResult } from './types';

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');
}

function toPascalCase(str: string): string {
    return str.replace(/(?:^|-|_)(\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, '');
}

function toCamelCase(str: string): string {
    const pascal = toPascalCase(str);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function generateSqlTemplates(
  models: ModelDefinition[],
  config: { multiTenant: boolean; useSchemas?: boolean }
): GenerationResult {
  let templates = '';
  const modelsByName = new Map(models.map(m => [m.name, m]));
  
  for (const model of models) {
    const modelNamePascal = toPascalCase(model.name);
    const tableName = toSnakeCase(model.name) + 's'; // simple pluralization
    const schemaPrefix = config.useSchemas ? 'public.' : '';
    const withSchema = (name: string) => `${schemaPrefix}${name}`;
    const tableRef = withSchema(tableName);
    const columns = Object.keys(model.schema)
        .filter(key => {
            const value = model.schema[key];
            return value && !(typeof value === 'object' && (value as any).__typeName === 'Relation');
        })
        .map(toSnakeCase);
    const columnString = columns.join(', ');
    
    const fields = Object.keys(model.schema);
    const primaryKeyField = fields.find(f => {
        const opts = model.schema[f];
        // FIX: Add robust check for null/relation objects before property access.
        return typeof opts === 'object' && opts && !(opts as any).__typeName && (opts as any).primaryKey;
    }) || 'id';
    const primaryKeyColumn = toSnakeCase(primaryKeyField);

    const tenantField = fields.find(f => {
        const opts = model.schema[f];
        // FIX: Add robust check for null/relation objects before property access.
        return typeof opts === 'object' && opts && !(opts as any).__typeName && (opts as any).tenant;
    });
    const tenantColumn = tenantField ? toSnakeCase(tenantField) : null;

    // INSERT
    const insertCols = columns.filter(c => c !== toSnakeCase(primaryKeyField));
    const insertPlaceholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
    const insertQuery = `export const create${modelNamePascal} = \`INSERT INTO ${tableRef} (${insertCols.join(', ')}) VALUES (${insertPlaceholders}) RETURNING ${columnString};\`;`;
    const insertParams = `// params: [${insertCols.map(c => c.replace(/_(\w)/g, (_, letter) => letter.toUpperCase())).join(', ')}]`;

    // SELECT BY ID
    let findByIdQuery = `export const find${modelNamePascal}ById = \`SELECT ${columnString} FROM ${tableRef} WHERE ${primaryKeyColumn} = $1;\`;`;
    if (config.multiTenant && tenantColumn) {
        findByIdQuery = `export const find${modelNamePascal}ById = \`SELECT ${columnString} FROM ${tableRef} WHERE ${primaryKeyColumn} = $1 AND ${tenantColumn} = $2;\`;`;
    }

    // UPDATE
    const updatableColumns = columns.filter(c => c !== primaryKeyColumn && (!tenantColumn || c !== tenantColumn));
    const updateAllowed = JSON.stringify(updatableColumns);
    let updateQuery = `export const update${modelNamePascal} = (updates: Record<string, any>) => {
  const filtered = Object.keys(updates)
    .map(key => ({ key, col: toSnakeCase(key) }))
    .filter(({ col }) => ${updateAllowed}.includes(col));
  if (filtered.length === 0) {
    throw new Error('No valid fields supplied for update on ${model.name}.');
  }
  const setters = filtered.map(({ col }, i) => \`\${col} = $\${i + 2}\`).join(', ');
  return \`UPDATE ${tableRef} SET \${setters} WHERE ${primaryKeyColumn} = $1 RETURNING ${columnString};\`;
};`;
    if (config.multiTenant && tenantColumn) {
      updateQuery = `export const update${modelNamePascal} = (updates: Record<string, any>) => {
  const filtered = Object.keys(updates)
    .map(key => ({ key, col: toSnakeCase(key) }))
    .filter(({ col }) => ${updateAllowed}.includes(col));
  if (filtered.length === 0) {
    throw new Error('No valid fields supplied for update on ${model.name}.');
  }
  const setters = filtered.map(({ col }, i) => \`\${col} = $\${i + 2}\`).join(', ');
  const tenantParamIndex = filtered.length + 2;
  return \`UPDATE ${tableRef} SET \${setters} WHERE ${primaryKeyColumn} = $1 AND ${tenantColumn} = $\${tenantParamIndex} RETURNING ${columnString};\`;
};`;
    }

    // DELETE
    let deleteQuery = `export const delete${modelNamePascal} = \`DELETE FROM ${tableRef} WHERE ${primaryKeyColumn} = $1;\`;`;
    if (config.multiTenant && tenantColumn) {
        deleteQuery = `export const delete${modelNamePascal} = \`DELETE FROM ${tableRef} WHERE ${primaryKeyColumn} = $1 AND ${tenantColumn} = $2;\`;`;
    }
    
    // --- Relation Queries ---
    let relationQueries = '';
    for (const rel of model.relations) {
        if (rel.type === 'hasMany') {
            const targetModel = modelsByName.get(rel.targetModelName);
            if (targetModel) {
                const targetTableName = toSnakeCase(targetModel.name) + 's';
                const targetRef = withSchema(targetTableName);
                const targetColumns = Object.keys(targetModel.schema)
                    .filter(key => {
                        const value = targetModel.schema[key];
                        return value && !(typeof value === 'object' && (value as any).__typeName === 'Relation');
                    })
                    .map(toSnakeCase).join(', ');
                const fkColumn = toSnakeCase(rel.foreignKey);
                const queryName = `find${toPascalCase(targetModel.name)}sBy${modelNamePascal}Id`;
                relationQueries += `export const ${queryName} = \`SELECT ${targetColumns} FROM ${targetRef} WHERE ${fkColumn} = $1;\`;\n`;
            }
        }
    }


    templates += `
// --- ${model.name} SQL ---
${insertQuery}
${insertParams}

${findByIdQuery}
// ${config.multiTenant && tenantColumn ? 'params: [id, tenantId]' : 'params: [id]'}

${updateQuery}
// ${config.multiTenant && tenantColumn ? 'params: [id, ...updateValues, tenantId]' : 'params: [id, ...updateValues]'}

${deleteQuery}
// ${config.multiTenant && tenantColumn ? 'params: [id, tenantId]' : 'params: [id]'}

${relationQueries}
`;
  };
  
  const snakeCaseHelper = `
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => \`_\${letter.toLowerCase()}\`).replace(/^_/, '');
}
`

  return {
    filePath: 'sql.ts',
    content: `
// THIS FILE IS AUTO-GENERATED BY FORGE. DO NOT EDIT.

${snakeCaseHelper}

${templates}
`,
  };
}
