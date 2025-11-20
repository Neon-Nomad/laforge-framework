
import { PolicyDefinition, ModelDefinition, FieldOptions, RelationDef } from '../ast/types.js';
import { parse, ParserOptions } from '@babel/parser';
import traverseModule, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

const traverse = (traverseModule as any).default || traverseModule;

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');
}

type Scope = Record<string, { model: ModelDefinition | null; alias?: string }>;

/**
 * A robust JS AST to SQL converter using Babel.
 * This translates a specific subset of JavaScript expressions into safe SQL.
 */
function compilePolicyToSql(source: string, model: ModelDefinition, allModels: ModelDefinition[]): string {
  const ast = parse(source, {
    plugins: ['typescript'],
  } as ParserOptions);

  let expressionNode: t.Expression | null = null;

  // Check if the program body is a single expression (bare expression or arrow function)
  const body = ast.program.body;
  if (body.length === 1 && t.isExpressionStatement(body[0])) {
    const expr = body[0].expression;
    if (t.isArrowFunctionExpression(expr)) {
      // It's a policy defined as a function: () => ...
      if (t.isBlockStatement(expr.body)) {
        const ret = expr.body.body.find(n => t.isReturnStatement(n)) as t.ReturnStatement;
        if (ret && ret.argument) expressionNode = ret.argument;
      } else {
        expressionNode = expr.body;
      }
    } else {
      // It's a bare expression: record.foo === bar
      expressionNode = expr;
    }
  } else {
    // Fallback: try to find an arrow function anywhere
    traverse(ast, {
      ArrowFunctionExpression(path: NodePath<t.ArrowFunctionExpression>) {
        if (expressionNode) return; // Already found one
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
        path.stop();
      },
    });
  }

  if (!expressionNode) {
    const body = source.trim();
    if (body === 'true') return 'TRUE';
    if (body === 'false') return 'FALSE';

    // Fallback for simple string matches if AST fails (legacy support)
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

  const initialScope: Scope = {
    record: { model, alias: undefined }, // undefined alias means refer to current row columns directly
    user: { model: null, alias: undefined }, // user is special global context
  };

  return nodeToSql(expressionNode, model, allModels, initialScope);
}

function nodeToSql(node: t.Node, model: ModelDefinition, allModels: ModelDefinition[], scope: Scope): string {
  // 1. Handle Collection Predicates (.some, .every, .includes)
  if (t.isCallExpression(node) && t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.property)) {
    const method = node.callee.property.name;
    if (['some', 'every', 'includes'].includes(method)) {
      return resolveCollectionPredicate(node, model, allModels, scope);
    }
    throw new Error(`Unsupported method ${method}`);
  }

  // 2. Handle Property Chains (record.team.owner.id)
  const chain = flattenChain(node);
  if (chain) {
    return resolveChainToSql(chain, model, allModels, scope);
  }

  switch (node.type) {
    case 'LogicalExpression':
      const op = node.operator === '&&' ? 'AND' : 'OR';
      return `(${nodeToSql(node.left, model, allModels, scope)} ${op} ${nodeToSql(node.right, model, allModels, scope)})`;

    case 'BinaryExpression':
      const supportedOps: Record<string, string> = {
        '===': '=', '!==': '!=',
        '==': '=', '!=': '!=',
        '>': '>', '<': '<', '>=': '>=', '<=': '<='
      };
      if (!supportedOps[node.operator]) {
        throw new Error(`Unsupported binary operator: ${node.operator}`);
      }
      return `${nodeToSql(node.left, model, allModels, scope)} ${supportedOps[node.operator]} ${nodeToSql(node.right, model, allModels, scope)}`;

    case 'UnaryExpression':
      if (node.operator !== '!') {
        throw new Error(`Unsupported unary operator: ${node.operator}`);
      }
      return `NOT ${nodeToSql(node.argument, model, allModels, scope)}`;

    case 'StringLiteral':
      return `'${node.value.replace(/'/g, "''")}'`;

    case 'NumericLiteral':
    case 'BooleanLiteral':
      return `${node.value}`;

    case 'Identifier':
      // Handle simple identifiers if they are in scope (e.g. inside a lambda)
      if (scope[node.name]) {
        // If it's an object reference without a property, we can't really map it to SQL unless it's for equality checks?
        // Usually we expect member expressions. But if we have `c.id === user.id`, `c` is an identifier.
        // But `c` itself isn't a value. `c.id` is.
        // If we see `c` here, it might be an error unless handled by parent.
        // However, if we have `includes(value)`, `value` might be an identifier.
        throw new Error(`Unexpected bare identifier "${node.name}". Did you mean to access a property?`);
      }
      throw new Error(`Unknown identifier: ${node.name}`);

    default:
      throw new Error(`Unsupported AST node type: ${node.type}`);
  }
}

function flattenChain(node: t.Node): string[] | null {
  if (t.isIdentifier(node)) {
    return [node.name];
  }
  if (t.isMemberExpression(node)) {
    const left = flattenChain(node.object);
    if (left && t.isIdentifier(node.property)) {
      return [...left, node.property.name];
    }
  }
  return null;
}

function resolveChainToSql(chain: string[], model: ModelDefinition, allModels: ModelDefinition[], scope: Scope): string {
  const rootName = chain[0];
  const root = scope[rootName];

  if (!root) {
    // Not a scoped variable (e.g. Math.max?), reject
    throw new Error(`Unknown variable in chain: ${rootName}`);
  }

  // Handle User Special Case
  if (rootName === 'user') {
    if (chain.length === 2) {
      const prop = chain[1];
      switch (prop) {
        case 'id': return "current_setting('app.user_id')::uuid";
        case 'tenantId': return "current_setting('app.tenant_id')::uuid";
        case 'role': return "current_setting('app.user_role')";
        default: throw new Error(`Unsupported user property: ${prop}`);
      }
    }
    throw new Error(`Unsupported user chain depth: ${chain.join('.')}`);
  }

  // Handle Record/Scoped Variable
  let currentModel = root.model!;
  let currentAlias = root.alias; // undefined for 'record' (implicit table), string for others

  // We will build a scalar subquery if we traverse relations
  // If we just access a field on the root, return column name

  if (chain.length === 2) {
    // Simple field access: record.status or c.status
    const fieldName = chain[1];

    // Check if it's a direct field
    if (currentModel.schema[fieldName]) {
      const col = toSnakeCase(fieldName);
      return currentAlias ? `${currentAlias}.${col}` : col;
    }

    // Check if it's a belongsTo FK
    const rel = currentModel.relations.find(r => r.name === fieldName && r.type === 'belongsTo');
    if (rel) {
      const col = toSnakeCase(rel.foreignKey);
      return currentAlias ? `${currentAlias}.${col}` : col;
    }

    throw new Error(`Property "${fieldName}" not found in model "${currentModel.name}".`);
  }

  // Deep traversal: record.team.owner.id
  // We need to generate a scalar subquery: (SELECT tN.col FROM ... joins ...)

  // Reset logic:
  currentModel = root.model!;
  let previousAlias = root.alias; // Outer alias

  const firstRelName = chain[1];
  const firstRel = currentModel.relations.find(r => r.name === firstRelName);
  if (!firstRel) throw new Error(`Relation "${firstRelName}" not found.`);

  const firstTargetModel = allModels.find(m => m.name === firstRel.targetModelName)!;
  const firstAlias = 'j0';
  const firstTable = `public.${toSnakeCase(firstTargetModel.name)}s`;

  let whereClause = '';
  if (firstRel.type === 'belongsTo') {
    const fk = toSnakeCase(firstRel.foreignKey);
    const outerVal = previousAlias ? `${previousAlias}.${fk}` : fk;
    whereClause = `${firstAlias}.id = ${outerVal}`;
  } else if (firstRel.type === 'hasMany') {
    const fk = toSnakeCase(firstRel.foreignKey);
    const outerId = previousAlias ? `${previousAlias}.id` : `id`;
    whereClause = `${firstAlias}.${fk} = ${outerId}`;
  }

  // Tenant check for first table
  const firstTenant = Object.entries(firstTargetModel.schema).find(([k, v]) => (v as FieldOptions).tenant);
  if (firstTenant) {
    whereClause += ` AND ${firstAlias}.${toSnakeCase(firstTenant[0])} = current_setting('app.tenant_id')::uuid`;
  }

  let query = `SELECT `;
  let from = ` FROM ${firstTable} ${firstAlias}`;
  let currentJoinAlias = firstAlias;
  let currentJoinModel = firstTargetModel;

  // Loop for remaining hops
  for (let i = 2; i < chain.length - 1; i++) {
    const relName = chain[i];
    const rel = currentJoinModel.relations.find(r => r.name === relName);
    if (!rel) throw new Error(`Relation "${relName}" not found.`);

    const targetModel = allModels.find(m => m.name === rel.targetModelName)!;
    const targetAlias = `j${i - 1}`;
    const targetTable = `public.${toSnakeCase(targetModel.name)}s`;

    if (rel.type === 'belongsTo') {
      const fk = toSnakeCase(rel.foreignKey);
      from += ` JOIN ${targetTable} ${targetAlias} ON ${targetAlias}.id = ${currentJoinAlias}.${fk}`;
    } else if (rel.type === 'hasMany') {
      const fk = toSnakeCase(rel.foreignKey);
      from += ` JOIN ${targetTable} ${targetAlias} ON ${targetAlias}.${fk} = ${currentJoinAlias}.id`;
    }

    // Tenant check
    const tenant = Object.entries(targetModel.schema).find(([k, v]) => (v as FieldOptions).tenant);
    if (tenant) {
      from += ` AND ${targetAlias}.${toSnakeCase(tenant[0])} = current_setting('app.tenant_id')::uuid`;
    }

    currentJoinAlias = targetAlias;
    currentJoinModel = targetModel;

    if (i > 3) throw new Error(`Chain depth limit exceeded (max 3 hops).`);
  }

  const finalFieldName = chain[chain.length - 1];
  if (!currentJoinModel.schema[finalFieldName]) throw new Error(`Property "${finalFieldName}" not found.`);

  // Fixed space issue here:
  query += `${currentJoinAlias}.${toSnakeCase(finalFieldName)}${from} WHERE ${whereClause}`;

  return `(${query})`;
}

function resolveCollectionPredicate(node: t.CallExpression, model: ModelDefinition, allModels: ModelDefinition[], scope: Scope): string {
  // record.members.some(m => m.id === user.id)
  const callee = node.callee as t.MemberExpression;
  const method = (callee.property as t.Identifier).name;
  const chain = flattenChain(callee.object);

  if (!chain) throw new Error("Invalid collection access.");

  const rootName = chain[0];
  const root = scope[rootName];
  if (!root) throw new Error(`Unknown variable: ${rootName}`);

  let currentModel = root.model!;
  let previousAlias = root.alias;

  let subqueryFrom = '';
  let subqueryWhere = '';
  let currentAlias = ''; // The alias of the collection table

  const firstRelName = chain[1];
  const firstRel = currentModel.relations.find(r => r.name === firstRelName);
  if (!firstRel) throw new Error(`Relation "${firstRelName}" not found.`);
  const firstTarget = allModels.find(m => m.name === firstRel.targetModelName)!;
  const firstAlias = 's0';
  const firstTable = `public.${toSnakeCase(firstTarget.name)}s`;

  if (firstRel.type === 'belongsTo') {
    const fk = toSnakeCase(firstRel.foreignKey);
    const outerVal = previousAlias ? `${previousAlias}.${fk}` : fk;
    subqueryWhere = `${firstAlias}.id = ${outerVal}`;
  } else if (firstRel.type === 'hasMany') {
    const fk = toSnakeCase(firstRel.foreignKey);
    const outerId = previousAlias ? `${previousAlias}.id` : `id`;
    subqueryWhere = `${firstAlias}.${fk} = ${outerId}`;
  }

  // Tenant check
  const firstTenant = Object.entries(firstTarget.schema).find(([k, v]) => (v as FieldOptions).tenant);
  if (firstTenant) {
    subqueryWhere += ` AND ${firstAlias}.${toSnakeCase(firstTenant[0])} = current_setting('app.tenant_id')::uuid`;
  }

  subqueryFrom = `FROM ${firstTable} ${firstAlias}`;
  currentAlias = firstAlias;
  currentModel = firstTarget;

  // Remaining hops
  for (let i = 2; i < chain.length; i++) {
    const relName = chain[i];
    const rel = currentModel.relations.find(r => r.name === relName);
    if (!rel) throw new Error(`Relation "${relName}" not found.`);
    const target = allModels.find(m => m.name === rel.targetModelName)!;
    const targetAlias = `s${i - 1}`;
    const targetTable = `public.${toSnakeCase(target.name)}s`;

    if (rel.type === 'belongsTo') {
      const fk = toSnakeCase(rel.foreignKey);
      subqueryFrom += ` JOIN ${targetTable} ${targetAlias} ON ${targetAlias}.id = ${currentAlias}.${fk}`;
    } else if (rel.type === 'hasMany') {
      const fk = toSnakeCase(rel.foreignKey);
      subqueryFrom += ` JOIN ${targetTable} ${targetAlias} ON ${targetAlias}.${fk} = ${currentAlias}.id`;
    }

    // Tenant check
    const tenant = Object.entries(target.schema).find(([k, v]) => (v as FieldOptions).tenant);
    if (tenant) {
      subqueryFrom += ` AND ${targetAlias}.${toSnakeCase(tenant[0])} = current_setting('app.tenant_id')::uuid`;
    }

    currentAlias = targetAlias;
    currentModel = target;
  }

  // Parse the predicate
  if (method === 'includes') {
    const valueNode = node.arguments[0];
    const valueSql = nodeToSql(valueNode, model, allModels, scope);

    const pk = Object.entries(currentModel.schema).find(([k, v]) => (v as FieldOptions).primaryKey);
    if (!pk) throw new Error(`Model ${currentModel.name} has no PK, cannot use includes.`);
    const pkCol = toSnakeCase(pk[0]);

    return `${valueSql} IN (SELECT ${currentAlias}.${pkCol} ${subqueryFrom} WHERE ${subqueryWhere})`;
  }

  const callback = node.arguments[0];
  if (!t.isArrowFunctionExpression(callback)) throw new Error("Collection predicate must be an arrow function.");

  const param = callback.params[0];
  if (!t.isIdentifier(param)) throw new Error("Callback parameter must be an identifier.");

  const newScope: Scope = {
    ...scope,
    [param.name]: { model: currentModel, alias: currentAlias }
  };

  let bodyNode = callback.body;
  if (t.isBlockStatement(bodyNode)) {
    const ret = bodyNode.body.find(n => t.isReturnStatement(n)) as t.ReturnStatement;
    if (!ret || !ret.argument) throw new Error("Callback must return a value.");
    bodyNode = ret.argument;
  }

  const predicateSql = nodeToSql(bodyNode, model, allModels, newScope);

  if (method === 'some') {
    return `EXISTS (SELECT 1 ${subqueryFrom} WHERE ${subqueryWhere} AND (${predicateSql}))`;
  } else if (method === 'every') {
    return `NOT EXISTS (SELECT 1 ${subqueryFrom} WHERE ${subqueryWhere} AND NOT (${predicateSql}))`;
  }

  throw new Error(`Unsupported method ${method}`);
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
      const usingExpression = compilePolicyToSql(readPolicy.handlerSource, model, models);
      const finalExpression = tenantPolicy ? `(${tenantPolicy}) AND (${usingExpression})` : `(${usingExpression})`;
      rlsSql += `CREATE POLICY forge_select_${tableName} ON ${tableRef} FOR SELECT USING ${finalExpression};\n`;
    } else if (tenantPolicy) {
      rlsSql += `CREATE POLICY forge_select_${tableName} ON ${tableRef} FOR SELECT USING (${tenantPolicy});\n`;
    }

    const createPolicy = model.policies.create;
    let withCheckExpression = tenantPolicy ? `(${tenantPolicy})` : 'true';
    if (createPolicy) {
      const createExpression = compilePolicyToSql(createPolicy.handlerSource, model, models);
      withCheckExpression = tenantPolicy ? `(${tenantPolicy}) AND (${createExpression})` : `(${createExpression})`;
    }
    rlsSql += `CREATE POLICY forge_insert_${tableName} ON ${tableRef} FOR INSERT WITH CHECK ${withCheckExpression};\n`;

    const updatePolicy = model.policies.update;
    if (updatePolicy) {
      const usingExpression = compilePolicyToSql(updatePolicy.handlerSource, model, models);
      const finalExpression = tenantPolicy ? `(${tenantPolicy}) AND (${usingExpression})` : `(${usingExpression})`;
      rlsSql += `CREATE POLICY forge_update_${tableName} ON ${tableRef} FOR UPDATE USING ${finalExpression} WITH CHECK ${finalExpression};\n`;
    } else if (tenantPolicy) {
      rlsSql += `CREATE POLICY forge_update_${tableName} ON ${tableRef} FOR UPDATE USING (${tenantPolicy}) WITH CHECK (${tenantPolicy});\n`;
    }

    const deletePolicy = model.policies.delete;
    if (deletePolicy) {
      const usingExpression = compilePolicyToSql(deletePolicy.handlerSource, model, models);
      const finalExpression = tenantPolicy ? `(${tenantPolicy}) AND (${usingExpression})` : `(${usingExpression})`;
      rlsSql += `CREATE POLICY forge_delete_${tableName} ON ${tableRef} FOR DELETE USING ${finalExpression};\n`;
    } else if (tenantPolicy) {
      rlsSql += `CREATE POLICY forge_delete_${tableName} ON ${tableRef} FOR DELETE USING (${tenantPolicy});\n`;
    }
  }

  return rlsSql;
}
