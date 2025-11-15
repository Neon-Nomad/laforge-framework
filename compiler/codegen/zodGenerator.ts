
import { ModelDefinition, FieldOptions, FieldType } from '../ast/types.js';
import { GenerationResult } from '../ast/types.js';

function toPascalCase(str: string): string {
  return str.replace(/(?:^|-|_)(\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, '');
}

function mapTypeToZod(fieldType: string | FieldOptions): string {
  const type = typeof fieldType === 'object' ? fieldType.type : fieldType;
  const isOptional = typeof fieldType === 'object' && fieldType.optional;
  let zodType: string;

  switch (type) {
    case 'uuid':
      zodType = 'z.string().uuid()';
      break;
    case 'string':
    case 'text':
      zodType = 'z.string()';
      break;
    case 'integer':
      zodType = 'z.number().int()';
      break;
    case 'boolean':
      zodType = 'z.boolean()';
      break;
    case 'datetime':
      zodType = 'z.date()';
      break;
    case 'jsonb':
      zodType = 'z.any()';
      break;
    default:
      zodType = 'z.unknown()';
  }

  if (isOptional) {
    zodType += '.optional()';
  }

  return zodType;
}

export function generateZodSchemas(models: ModelDefinition[]): GenerationResult {
  const zHeader = 'const z = require("zod").z;\n';

  const schemas = models.map(model => {
    const schemaName = `${toPascalCase(model.name)}Schema`;
    const createSchemaName = `Create${toPascalCase(model.name)}Schema`;
    const updateSchemaName = `Update${toPascalCase(model.name)}Schema`;

    const modelFields = Object.entries(model.schema)
      .filter(([, value]) => value && !(typeof value === 'object' && (value as any).__typeName === 'Relation')) as [string, FieldType | FieldOptions][];

    const tenantField = modelFields.find(([, value]) => typeof value === 'object' && value.tenant)?.[0];
    const primaryKeyField = modelFields.find(([, value]) => typeof value === 'object' && value.primaryKey)?.[0];

    const fields = modelFields
      .map(([name, type]) => `  ${name}: ${mapTypeToZod(type)},`)
      .join('\n');

    const createFields = modelFields
      .filter(([name]) => name !== primaryKeyField && name !== 'createdAt' && name !== 'updatedAt' && name !== tenantField)
      .map(([name, type]) => {
        const fieldOptions = typeof type === 'object' ? type : { type };
        const needsOptional = typeof type === 'object' && type.default;
        const isOptional = needsOptional ? { ...fieldOptions, optional: true } : type;
        return `  ${name}: ${mapTypeToZod(isOptional)},`;
      })
      .join('\n');

    const updateFields = modelFields
      .filter(([name]) => name !== primaryKeyField && name !== 'createdAt' && name !== 'updatedAt' && name !== tenantField)
      .map(([name, type]) => {
        const fieldOptions = typeof type === 'object' ? type : { type };
        const optionalType = { ...fieldOptions, optional: true };
        return `  ${name}: ${mapTypeToZod(optionalType)},`;
      })
      .join('\n');

    return `
export const ${schemaName} = z.object({
${fields}
});

export const ${createSchemaName} = z.object({
${createFields}
});

export const ${updateSchemaName} = z.object({
${updateFields}
});

export type ${toPascalCase(model.name)} = z.infer<typeof ${schemaName}>;
export type Create${toPascalCase(model.name)} = z.infer<typeof ${createSchemaName}>;
export type Update${toPascalCase(model.name)} = z.infer<typeof ${updateSchemaName}>;
`;
  }).join('\n');

  const content = `
${zHeader}
${schemas}
`;

  return {
    filePath: 'zod.ts',
    content,
  };
}
