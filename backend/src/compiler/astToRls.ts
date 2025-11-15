
import { PolicyDefinition, ModelDefinition, FieldOptions } from './types';
import { parse, ParserOptions } from '@babel/parser';
import traverseModule, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

const traverse = (traverseModule as any).default || traverseModule;

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');
}

/**
 * A robust JS AST to SQL converter using Babel.
 * This translates a specific subset of JavaScript expressions into safe SQL.
 */
function compilePolicyToSql(source: string, model: ModelDefinition): string {
  const ast = parse(source, {
    plugins: ['typescript'],
  } as ParserOptions);

  let expressionNode: t.Expression | null = null;

  traverse(ast, {
    ArrowFunctionExpression(path: NodePath<t.ArrowFunctionExpression>) {
      // Find the body of the arrow function
      if (t.isBlockStatement(path.node.body)) {
        const returnStatement = path.node.body.body.find(
          (node: t.Node): node is t.ReturnStatement => t.isReturnStatement(node)
        );
        if (returnStatement && returnStatement.argument) {
          expressionNode = returnStatement.argument;
        }
      } else {
        expressionNode = path.node.body;
      }
      path.stop(); // We only care about the first arrow function
    },
  });

  if (!expressionNode) {
    const body = source.trim();
    if (body === 'true') {
      return 'TRUE';
    }
    if (body === 'false') {
      return 'FALSE';
    }
    const simpleBinary = body.match(/^record\.(\w+)\s*==\s*["']([^"']+)["']$/);
    if (simpleBinary) {
      const [, field, value] = simpleBinary;
      if (!model.schema.hasOwnProperty(field)) {
        throw new Error(`Property "${field}" not found in model "${model.name}" schema during RLS generation.`);
      }
      return `${toSnakeCase(field)} = '${value.replace(/'/g, "''")}'`;
    }
    throw new Error(`Could not find a valid expression in the policy handler: ${body}`);
  }

  return nodeToSql(expressionNode, model);
}

function nodeToSql(node: t.Node, model: ModelDefinition): string {
  switch (node.type) {
    case 'LogicalExpression':
      const op = node.operator === '&&' ? 'AND' : 'OR';
      return `(${nodeToSql(node.left, model)} ${op} ${nodeToSql(node.right, model)})`;

    case 'BinaryExpression':
      const supportedOps: Record<string, string> = {
          '===': '=', '!==': '!=',
          '>': '>', '<': '<', '>=': '>=', '<=': '<='
      };
      if (!supportedOps[node.operator]) {
        throw new Error(`Unsupported binary operator: ${node.operator}`);
      }
      return `${nodeToSql(node.left, model)} ${supportedOps[node.operator]} ${nodeToSql(node.right, model)}`;
    
    case 'UnaryExpression':
        if (node.operator !== '!') {
            throw new Error(`Unsupported unary operator: ${node.operator}`);
        }
        return `NOT ${nodeToSql(node.argument, model)}`;

    case 'CallExpression':
      if (
        t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.property) &&
        node.callee.property.name === 'includes' &&
        node.arguments.length === 1
      ) {
        const arrayExpr = nodeToSql(node.callee.object, model);
        const valueExpr = nodeToSql(node.arguments[0], model);
        // This translates `array.includes(value)` to SQL `value = ANY(array_column)`
        return `${valueExpr} = ANY(${arrayExpr})`;
      }
      throw new Error(`Unsupported call expression.`);

    case 'MemberExpression':
      if (!t.isIdentifier(node.object) || !t.isIdentifier(node.property)) {
        throw new Error('Unsupported member expression: Must be simple identifiers like `user.id` or `record.name`.');
      }
      const objectName = node.object.name;
      const propertyName = node.property.name;

      if (objectName === 'user') {
        switch (propertyName) {
          case 'id': return "current_setting('app.user_id')::uuid";
          case 'tenantId': return "current_setting('app.tenant_id')::uuid";
          case 'role': return "current_setting('app.user_role')";
          default: throw new Error(`Unsupported user property: ${propertyName}`);
        }
      }

      if (objectName === 'record' || objectName === 'input') {
        if (!model.schema.hasOwnProperty(propertyName)) {
            throw new Error(`Property "${propertyName}" not found in model "${model.name}" schema during RLS generation.`);
        }
        return toSnakeCase(propertyName);
      }
      throw new Error(`Unsupported object in expression: ${objectName}`);

    case 'StringLiteral':
      // Basic escaping, good enough for this context as we are not taking user input
      return `'${node.value.replace(/'/g, "''")}'`;
    
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return `${node.value}`;

    default:
      throw new Error(`Unsupported AST node type: ${node.type}`);
  }
}

export function generateRlsPolicies(
  models: ModelDefinition[],
  config: { multiTenant: boolean; useSchemas?: boolean }
): string {
    let rlsSql = `
-- THIS FILE IS AUTO-GENERATED BY FORGE. DO NOT EDIT.
-- Ensure you have a user context setter function, e.g.:
-- CREATE OR REPLACE FUNCTION set_app_user(user_id UUID, tenant_id UUID, user_role TEXT)
-- RETURNS void AS $$
-- BEGIN
--   PERFORM set_config('app.user_id', user_id::text, false);
--   PERFORM set_config('app.tenant_id', tenant_id::text, false);
--   PERFORM set_config('app.user_role', user_role, false);
-- END;
-- $$ LANGUAGE plpgsql;

`;

    for (const model of models) {
        const tableName = toSnakeCase(model.name) + 's';
        const schemaPrefix = config.useSchemas ? 'public.' : '';
        const tableRef = `${schemaPrefix}${tableName}`;
        const tenantField = Object.keys(model.schema).find(f => {
            const opts = model.schema[f];
            // FIX: Check that the schema property is a field definition, not a relation, before accessing 'tenant'.
            return typeof opts === 'object' && !!opts && !(opts as any).__typeName && (opts as FieldOptions).tenant;
        });
        const tenantColumn = tenantField ? toSnakeCase(tenantField) : null;

        rlsSql += `\n-- RLS Policies for ${tableName}\n`;
        rlsSql += `ALTER TABLE ${tableRef} ENABLE ROW LEVEL SECURITY;\n`;
        rlsSql += `DROP POLICY IF EXISTS forge_delete_${tableName} ON ${tableRef};\n`;
        rlsSql += `DROP POLICY IF EXISTS forge_update_${tableName} ON ${tableRef};\n`;
        rlsSql += `DROP POLICY IF EXISTS forge_select_${tableName} ON ${tableRef};\n`;
        rlsSql += `DROP POLICY IF EXISTS forge_insert_${tableName} ON ${tableRef};\n`;


        let tenantPolicy = '';
        if (config.multiTenant && tenantColumn) {
            tenantPolicy = `${tenantColumn} = current_setting('app.tenant_id')::uuid`;
        }

        const readPolicy = model.policies.read;
        if (readPolicy) {
            const usingExpression = compilePolicyToSql(readPolicy.handlerSource, model);
            const finalExpression = tenantPolicy ? `(${tenantPolicy}) AND (${usingExpression})` : `(${usingExpression})`;
            rlsSql += `CREATE POLICY forge_select_${tableName} ON ${tableRef} FOR SELECT USING ${finalExpression};\n`;
        } else if (tenantPolicy) {
            // Default to tenant isolation if no specific read policy
            rlsSql += `CREATE POLICY forge_select_${tableName} ON ${tableRef} FOR SELECT USING (${tenantPolicy});\n`;
        }

        const createPolicy = model.policies.create;
        let withCheckExpression = tenantPolicy ? `(${tenantPolicy})` : 'true';
        if (createPolicy) {
             const createExpression = compilePolicyToSql(createPolicy.handlerSource, model);
             withCheckExpression = tenantPolicy ? `(${tenantPolicy}) AND (${createExpression})` : `(${createExpression})`;
        }
        rlsSql += `CREATE POLICY forge_insert_${tableName} ON ${tableRef} FOR INSERT WITH CHECK ${withCheckExpression};\n`;

        const updatePolicy = model.policies.update;
        if (updatePolicy) {
            const usingExpression = compilePolicyToSql(updatePolicy.handlerSource, model);
            const finalExpression = tenantPolicy ? `(${tenantPolicy}) AND (${usingExpression})` : `(${usingExpression})`;
            rlsSql += `CREATE POLICY forge_update_${tableName} ON ${tableRef} FOR UPDATE USING ${finalExpression} WITH CHECK ${finalExpression};\n`;
        } else if (tenantPolicy) {
            rlsSql += `CREATE POLICY forge_update_${tableName} ON ${tableRef} FOR UPDATE USING (${tenantPolicy}) WITH CHECK (${tenantPolicy});\n`;
        }

        const deletePolicy = model.policies.delete;
        if (deletePolicy) {
            const usingExpression = compilePolicyToSql(deletePolicy.handlerSource, model);
            const finalExpression = tenantPolicy ? `(${tenantPolicy}) AND (${usingExpression})` : `(${usingExpression})`;
            rlsSql += `CREATE POLICY forge_delete_${tableName} ON ${tableRef} FOR DELETE USING ${finalExpression};\n`;
        } else if (tenantPolicy) {
            rlsSql += `CREATE POLICY forge_delete_${tableName} ON ${tableRef} FOR DELETE USING (${tenantPolicy});\n`;
        }
    }

    return rlsSql;
}
