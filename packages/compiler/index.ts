import { modelRegistry } from './ast/registry.js';
import { generateZodSchemas } from './codegen/zodGenerator.js';
import { generateDomainServices } from './codegen/domainGenerator.js';
import { generateRlsPolicies, compilePolicyToSql } from './rls/astToRls.js';
import { generateFastifyAdapter } from './codegen/fastifyAdapter.js';
import { generateMigrations } from './diffing/migrationGenerator.js';
import { generateReactApplication } from './codegen/reactGenerator.js';
import type {
    ForgeConfig,
    ModelDefinition,
    ModelSchema,
    FieldOptions,
    FieldType,
    PolicyAction,
    HookType,
    ExtensionHandler,
    GenerationResult,
    PermissionRule,
    ModelRbacSpec,
    CompiledPermissionRule,
} from './ast/types.js';

export interface CompilationOutput {
    ast: string;
    zod: string;
    sql: string;
    domain: string;
    rls: string;
    routes: string;
    models: ModelDefinition[]; // Pass the raw models for the runtime
    migrations: GenerationResult[];
    config: ForgeConfig;
    zodSchemas?: string;
    sqlQueries?: string;
    rbac?: ModelRbacSpec[];
}

export interface CompilationResult {
    success: boolean;
    output?: CompilationOutput;
    error?: string;
}

const defaultConfig: ForgeConfig = {
    domain: [],
    outDir: 'generated',
    db: 'postgres',
    dialect: 'postgres-rds',
    audit: true,
    multiTenant: true,
    useSchemas: false,
    migrations: {
        allowDestructive: false,
    },
};

function toCamelCase(str: string): string {
    const pascal = str.replace(/(?:^|-|_)(\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, '');
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function detectRelationCycles(models: ModelDefinition[]): void {
    const graph = new Map<string, Set<string>>();
    for (const model of models) {
        const deps = new Set<string>();
        for (const rel of model.relations) {
            if (rel.type === 'belongsTo') {
                if (rel.targetModelName === model.name) continue; // allow self-references without treating as cycles
                deps.add(rel.targetModelName);
            }
        }
        graph.set(model.name, deps);
    }

    const visited = new Set<string>();
    const stack = new Set<string>();

    const visit = (node: string) => {
        if (stack.has(node)) {
            const cycle = [...stack, node].join(' -> ');
            throw new Error(`Cyclic relation detected: ${cycle}`);
        }
        if (visited.has(node)) return;
        visited.add(node);
        stack.add(node);
        const neighbors = graph.get(node) || new Set<string>();
        for (const neighbor of neighbors) {
            if (graph.has(neighbor)) {
                visit(neighbor);
            }
        }
        stack.delete(node);
    };

    for (const name of graph.keys()) {
        visit(name);
    }
}

function parseModelFields(modelName: string, body: string): { schema: ModelSchema } {
    const schema: ModelSchema = {};
    const lines = body
        .split('\n')
        .map(l => l.split(','))
        .flat()
        .map(l => l.trim())
        .filter(Boolean);

    for (const line of lines) {
        // Skip relation lines for now, they are handled separately
        if (line.match(/:\s*(belongsTo|hasMany|manyToMany)\(/)) {
            continue;
        }

        const fieldMatch = line.match(/^(\w+):\s*(\w+)/);
        if (fieldMatch) {
            const [, name, type] = fieldMatch;
            const normalizedType = type === 'int' ? 'integer' : type;
            const options: FieldOptions = { type: normalizedType as FieldType };
            const restOfLine = line.substring(fieldMatch[0].length).trim();

            if (restOfLine.includes('pk')) options.primaryKey = true;
            if (restOfLine.includes('tenant')) options.tenant = true;
            if (restOfLine.includes('optional')) options.optional = true;
            if (restOfLine.includes('unique')) options.unique = true;

            const defaultMatch = restOfLine.match(/default\s+("([^"]*)"|'([^']*)'|([\w\(\)]+))/);
            if (defaultMatch) {
                options.default = defaultMatch[2] || defaultMatch[3] || defaultMatch[4];
            }

            // Explicitly carry nullability so downstream consumers don't have to infer undefined as false.
            if (options.optional !== true) options.optional = false;

            schema[name] = options;
        }
    }

    // Auto-assign primary key to 'id' if no other pk is found
    if (schema.id && typeof schema.id === 'object' && !(schema.id as any).primaryKey) {
        const pkCount = Object.values(schema).filter(v => typeof v === 'object' && (v as FieldOptions).primaryKey).length;
        if (pkCount === 0) {
            (schema.id as FieldOptions).primaryKey = true;
        }
    }

    return { schema };
}

function parseModelRelations(modelDef: ModelDefinition, body: string, allModels: Map<string, ModelDefinition>) {
    const lines = body
        .split('\n')
        .map(l => l.split(','))
        .flat()
        .map(l => l.trim())
        .filter(Boolean);

    for (const line of lines) {
        const relationMatch = line.match(/^(\w+):\s*(belongsTo|hasMany|manyToMany)\(["']?(\w+)["']?\)/);
        if (relationMatch) {
            const [, name, type, targetModelName] = relationMatch;

            if (!allModels.has(targetModelName)) {
                throw new Error(`In model "${modelDef.name}", relation "${name}" points to an undefined model "${targetModelName}".`);
            }

            if (type === 'belongsTo') {
                const foreignKey = `${name}Id`;
                if (!modelDef.schema[foreignKey]) {
                    modelDef.schema[foreignKey] = { type: 'uuid', optional: false };
                }
                // Default to cascading deletes for belongsTo to avoid orphaned rows (can be made configurable later).
                modelDef.relations.push({ name, type: 'belongsTo', targetModelName, foreignKey, onDelete: 'cascade' });
            } else if (type === 'hasMany') {
                const remoteForeignKey = `${toCamelCase(modelDef.name)}Id`;
                modelDef.relations.push({ name, type: 'hasMany', targetModelName, foreignKey: remoteForeignKey, onDelete: 'cascade' });
            } else if (type === 'manyToMany') {
                const thisModelFk = `${toCamelCase(modelDef.name)}Id`;
                const joinTableName = [modelDef.name, targetModelName].sort().join('_').toLowerCase() + 's';
                modelDef.relations.push({ name, type: 'manyToMany', targetModelName, foreignKey: thisModelFk, through: joinTableName, onDelete: 'cascade' });
            }
        }
    }
}

function parseRoles(code: string): string[] {
    const roles = new Set<string>();
    const rolesRegex = /roles\s*{([^}]*)}/g;
    let match;
    while ((match = rolesRegex.exec(code)) !== null) {
        const body = match[1];
        const tokens = body.match(/[A-Za-z0-9_\-\.]+/g) || [];
        tokens.forEach(token => roles.add(token));
    }
    return Array.from(roles);
}

function parseClaims(code: string, roles: Set<string>): { claims: string[]; roleClaims: Record<string, string[]> } {
    const claims = new Set<string>();
    const roleClaims: Record<string, string[]> = {};
    const claimsRegex = /claims\s*{([^}]*)}/g;
    let match;

    const addClaim = (claim: string) => {
        if (claim) claims.add(claim);
    };

    while ((match = claimsRegex.exec(code)) !== null) {
        const body = match[1];
        const lines = body
            .split('\n')
            .map(l => l.split(','))
            .flat()
            .map(l => l.trim())
            .filter(Boolean);

        for (const line of lines) {
            const binding = line.split(':');
            if (binding.length > 1) {
                const role = binding[0].trim();
                if (!roles.has(role)) {
                    throw new Error(`Claims block references unknown role "${role}". Declare it in the roles block.`);
                }
                const claimTokens = binding[1].split('|').map(token => token.trim()).filter(Boolean);
                claimTokens.forEach(addClaim);
                if (!roleClaims[role]) roleClaims[role] = [];
                claimTokens.forEach(claim => {
                    if (!roleClaims[role].includes(claim)) {
                        roleClaims[role].push(claim);
                    }
                });
            } else {
                addClaim(line);
            }
        }
    }

    return { claims: Array.from(claims), roleClaims };
}

function parsePermissions(
    blocks: { body: string }[],
    models: Map<string, ModelDefinition>,
    roles: Set<string>,
    claims: Set<string>,
): Map<string, Partial<Record<PolicyAction, PermissionRule>>> {
    const permissions = new Map<string, Partial<Record<PolicyAction, PermissionRule>>>();

    for (const { body } of blocks) {
        const modelBlockRegex = /model\s+(\w+)\s*{([\s\S]*?)}/g;
        let modelMatch;
        while ((modelMatch = modelBlockRegex.exec(body)) !== null) {
            const [, modelName, modelBody] = modelMatch;
            if (!models.has(modelName)) {
                throw new Error(`Permissions block references unknown model "${modelName}".`);
            }
            const lines = modelBody
                .split('\n')
                .map(l => l.trim())
                .filter(Boolean);
            for (const line of lines) {
                const actionMatch = line.match(/^(create|read|update|delete)\s*:\s*(.+)$/);
                if (!actionMatch) continue;
                const action = actionMatch[1] as PolicyAction;
                const rawRule = actionMatch[2].trim();

                const trimmedRule = rawRule.trim();
                let requirementsPart = trimmedRule;
                let condition: string | undefined;

                if (trimmedRule.toLowerCase().startsWith('if ')) {
                    requirementsPart = '';
                    condition = trimmedRule.slice(3).trim();
                } else {
                    const split = trimmedRule.split(/\s+if\s+/i);
                    requirementsPart = split[0];
                    condition = split[1]?.trim();
                }

                const rule: PermissionRule = { roles: [], claims: [], condition };

                const tokens = (requirementsPart || '')
                    .split('|')
                    .map(t => t.trim())
                    .filter(Boolean);

                for (const token of tokens) {
                    if (!token) continue;
                    if (token.includes('.')) {
                        if (!claims.has(token)) {
                            throw new Error(`Permissions reference unknown claim "${token}". Declare it in the claims block.`);
                        }
                        rule.claims.push(token);
                    } else {
                        if (!roles.has(token)) {
                            throw new Error(`Permissions reference unknown role "${token}". Declare it in the roles block.`);
                        }
                        rule.roles.push(token);
                    }
                }

                if (rule.roles.length === 0 && rule.claims.length === 0 && !rule.condition) {
                    throw new Error(`Permissions for ${modelName}.${action} must specify roles/claims or an attribute condition.`);
                }

                if (!permissions.has(modelName)) {
                    permissions.set(modelName, {});
                }
                permissions.get(modelName)![action] = rule;
            }
        }
    }

    return permissions;
}

function findBlocks(code: string, keyword: string): { body: string; start: number; end: number }[] {
    const blocks: { body: string; start: number; end: number }[] = [];
    let index = 0;

    while (index < code.length) {
        const keywordIndex = code.indexOf(keyword, index);
        if (keywordIndex === -1) break;
        const openIndex = code.indexOf('{', keywordIndex);
        if (openIndex === -1) break;

        let depth = 0;
        let endIndex = -1;
        for (let i = openIndex; i < code.length; i++) {
            const ch = code[i];
            if (ch === '{') depth++;
            if (ch === '}') depth--;
            if (depth === 0) {
                endIndex = i;
                break;
            }
        }

        if (endIndex === -1) {
            break;
        }

        blocks.push({ body: code.slice(openIndex + 1, endIndex), start: keywordIndex, end: endIndex });
        index = endIndex + 1;
    }

  return blocks;
}

const RBAC_ACTIONS: PolicyAction[] = ['create', 'read', 'update', 'delete'];

function compileAbacCondition(condition: string | undefined, model: ModelDefinition, allModels: ModelDefinition[]): string | undefined {
  if (!condition || !condition.trim()) return undefined;
  return compilePolicyToSql(condition, model, allModels);
}

function computeRbacSpecs(models: ModelDefinition[]): ModelRbacSpec[] {
  return models.map(model => {
    const actions: Record<string, CompiledPermissionRule | undefined> = {};
    const perms = model.permissions ?? {};

    for (const action of RBAC_ACTIONS) {
      const rule = perms[action];
      if (!rule) continue;
      actions[action] = {
        roles: rule.roles ?? [],
        claims: rule.claims ?? [],
        abacSql: compileAbacCondition(rule.condition, model, models),
      };
    }

    const spec: ModelRbacSpec = {
      modelName: model.name,
      actions,
      raw: perms,
    };
    model.rbacSpec = spec;
    return spec;
  });
}

export function parseForgeDsl(code: string): ModelDefinition[] {
    const modelDefs = new Map<string, ModelDefinition>();
    const uncommentedCode = code.replace(/\/\/.*$/gm, '');
    const permissionsBlocks = findBlocks(uncommentedCode, 'permissions');
    const permissionsStripped = permissionsBlocks.reduceRight(
        (acc, block) => acc.slice(0, block.start) + acc.slice(block.end + 1),
        uncommentedCode,
    );
    const roles = new Set(parseRoles(uncommentedCode));
    const { claims, roleClaims } = parseClaims(uncommentedCode, roles);
    const claimsSet = new Set(claims);

    const codeForModels = permissionsStripped;
    const modelRegex = /model\s+(\w+)\s*{([^}]*)}/g;
    let match;

    // First pass: create all models so relations can be resolved
    while ((match = modelRegex.exec(codeForModels)) !== null) {
        const [, modelName, body] = match;
        const { schema } = parseModelFields(modelName, body);
        modelDefs.set(modelName, {
            name: modelName,
            schema,
            policies: {},
            relations: [],
            hooks: [],
            extensions: [],
            roles: Array.from(roles),
            claims: Array.from(claimsSet),
            roleClaims,
            permissions: {},
        });
    }

    // Second pass: parse relations now that all models are known
    modelRegex.lastIndex = 0;
    while ((match = modelRegex.exec(codeForModels)) !== null) {
        const [, modelName, body] = match;
        const modelDef = modelDefs.get(modelName)!;
        parseModelRelations(modelDef, body, modelDefs);
    }

    // Third pass: parse policies, hooks, and extensions
    const blockRegex = /(policy|hook|extend)\s+([\w\.]+)\s*{((?:[^{}]|{(?:[^{}]|{[^{}]*})*})*)}/g;
    while ((match = blockRegex.exec(codeForModels)) !== null) {
        const [, type, target, body] = match;
        const bodyContent = body.trim();

        const [modelName, subTarget] = target.split('.');
        const modelDef = modelDefs.get(modelName);

        if (!modelDef) {
            throw new Error(`Cannot apply '${type}' to unknown model "${modelName}".`);
        }

        if (type === 'policy') {
            const action = subTarget as PolicyAction;
            if (modelDef.policies[action]) {
                throw new Error(`Duplicate policy detected for ${modelName}.${action}`);
            }
            modelDef.policies[action] = { action, handler: () => false, handlerSource: bodyContent };
        } else if (type === 'hook') {
            const hookType = subTarget as HookType;
            modelDef.hooks.push({ type: hookType, handler: () => { }, handlerSource: bodyContent });
        } else if (type === 'extend') {
            const fullObjectSource = `({ ${bodyContent} })`;
            try {
                // We don't execute this, just need the source for the generator
                const methods = bodyContent.matchAll(/(\w+)\s*\(([^)]*)\)\s*\{/g);
                for (const methodMatch of methods) {
                    // This is a simplified parsing for the sandbox
                    const name = methodMatch[1];
                    modelDef.extensions.push({
                        name,
                        handler: () => { }, // Placeholder
                        handlerSource: `${name}${bodyContent.substring(bodyContent.indexOf('('))}`,
                    });
                }
            } catch (e: any) {
                throw new Error(`Syntax error in extend block for ${modelName}: ${e.message}`);
            }
        }
    }

    const allModelDefs = Array.from(modelDefs.values());

    for (const model of allModelDefs) {
        const hasPrimaryKey = Object.values(model.schema).some(
            (value) => typeof value === 'object' && (value as FieldOptions).primaryKey,
        );
        if (!hasPrimaryKey) {
            throw new Error(`Model "${model.name}" is missing a primary key. Add a field marked with "pk", e.g. "id: uuid pk".`);
        }

        // will populate permissions after parsing permissions block
    }

    const permissions = parsePermissions(permissionsBlocks, modelDefs, roles, claimsSet);
    for (const model of allModelDefs) {
        const perms = permissions.get(model.name);
        if (perms) {
            model.permissions = perms;
        }
    }

    computeRbacSpecs(allModelDefs);

    return allModelDefs;
}

/**
 * Main compiler function for the sandbox worker.
 * It takes DSL code and returns all generated artifacts.
 */
export function compileForSandbox(code: string, config: Partial<ForgeConfig> = {}): CompilationOutput {
    try {
        const models = parseForgeDsl(code);

        modelRegistry.clear();
        models.forEach(m => modelRegistry.registerModel(m));

        const allModels = modelRegistry.getAllModels();
        if (allModels.length === 0) {
            throw new Error("Compilation failed: No models were defined. Check your syntax for `model YourModel { ... }`.");
        }
        detectRelationCycles(allModels);

        const mergedConfig = { ...defaultConfig, ...config };
        const ast = JSON.stringify(allModels, null, 2);
        const zodResult = generateZodSchemas(allModels);
        const migrationResult = generateMigrations(allModels, mergedConfig); // The actual schema
        const domainResult = generateDomainServices(allModels, mergedConfig);
        const rlsResult = generateRlsPolicies(allModels, mergedConfig);
        const routesResult = generateFastifyAdapter(allModels);

        const boundSql = migrationResult.map(m => m.content).join('\n\n---\n\n');
        const rbacSpecs = computeRbacSpecs(allModels);
        return {
            ast: ast,
            zod: zodResult.content,
            sql: boundSql,
            domain: domainResult.content,
            rls: rlsResult,
            routes: routesResult.content,
            models: allModels,
            migrations: migrationResult,
            config: mergedConfig,
            rbac: rbacSpecs,

            // Required by runtime.ts
            zodSchemas: zodResult.content,
            sqlQueries: boundSql,
        };

    } catch (error: any) {
        console.error("Compilation Error:", error);

        let friendlyMessage = `An unexpected error occurred during compilation.\n\n${error.stack || error.message}`;

        if (error instanceof SyntaxError) {
            friendlyMessage = `Syntax Error: Your DSL code has a syntax error that prevents compilation. This often happens inside a policy, hook, or extend block.\n\n${error.message}`;
        } else if (error.message.includes('is not defined')) {
            friendlyMessage = `Parsing Error: Could not parse DSL. ${error.message}. Check for typos in your model definitions.`;
        } else {
            friendlyMessage = `Compilation Error: ${error.message}`;
        }

        // Re-throw with a cleaner message for the worker to catch
        throw new Error(friendlyMessage);
    }
}

export { generateReactApplication };
