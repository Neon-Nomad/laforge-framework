import { modelRegistry } from './registry';
import { generateZodSchemas } from './zodGenerator';
import { generateDomainServices } from './domainGenerator';
import { generateRlsPolicies } from './astToRls';
import { generateFastifyAdapter } from './fastifyAdapter';
import { generateMigrations } from './migrationGenerator';
import type { ForgeConfig, ModelDefinition, ModelSchema, FieldOptions, FieldType, PolicyAction, HookType, ExtensionHandler } from './types';

export interface CompilationOutput {
    ast: string;
    zod: string;
    sql: string;
    domain: string;
    rls: string;
    routes: string;
    models: ModelDefinition[]; // Pass the raw models for the runtime
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
};

function toCamelCase(str: string): string {
    const pascal = str.replace(/(?:^|-|_)(\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, '');
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function parseModelFields(modelName: string, body: string): { schema: ModelSchema } {
    const schema: ModelSchema = {};
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
        // Skip relation lines for now, they are handled separately
        if (line.match(/:\s*(belongsTo|hasMany|manyToMany)\(/)) {
            continue;
        }

        const fieldMatch = line.match(/^(\w+):\s*(\w+)/);
        if (fieldMatch) {
            const [, name, type] = fieldMatch;
            const options: FieldOptions = { type: type as FieldType };
            const restOfLine = line.substring(fieldMatch[0].length).trim();
            
            if (restOfLine.includes('pk')) options.primaryKey = true;
            if (restOfLine.includes('tenant')) options.tenant = true;
            if (restOfLine.includes('optional')) options.optional = true;
            
            const defaultMatch = restOfLine.match(/default\s+("([^"]*)"|'([^']*)'|([\w\(\)]+))/);
            if (defaultMatch) {
                options.default = defaultMatch[2] || defaultMatch[3] || defaultMatch[4];
            }
            
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
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
    
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
                    modelDef.schema[foreignKey] = { type: 'uuid' };
                }
                modelDef.relations.push({ name, type: 'belongsTo', targetModelName, foreignKey });
            } else if (type === 'hasMany') {
                const remoteForeignKey = `${toCamelCase(modelDef.name)}Id`;
                modelDef.relations.push({ name, type: 'hasMany', targetModelName, foreignKey: remoteForeignKey });
            } else if (type === 'manyToMany') {
                 const thisModelFk = `${toCamelCase(modelDef.name)}Id`;
                 const joinTableName = [modelDef.name, targetModelName].sort().join('_').toLowerCase() + 's';
                 modelDef.relations.push({ name, type: 'manyToMany', targetModelName, foreignKey: thisModelFk, through: joinTableName });
            }
        }
    }
}

function parseForgeDsl(code: string): ModelDefinition[] {
    const modelDefs = new Map<string, ModelDefinition>();
    const uncommentedCode = code.replace(/\/\/.*$/gm, '');

    const modelRegex = /model\s+(\w+)\s*{([^}]*)}/g;
    let match;
    
    // First pass: create all models so relations can be resolved
    while((match = modelRegex.exec(uncommentedCode)) !== null) {
        const [, modelName, body] = match;
        const { schema } = parseModelFields(modelName, body);
        modelDefs.set(modelName, {
            name: modelName,
            schema,
            policies: {},
            relations: [],
            hooks: [],
            extensions: [],
        });
    }

    // Second pass: parse relations now that all models are known
    modelRegex.lastIndex = 0;
    while((match = modelRegex.exec(uncommentedCode)) !== null) {
        const [, modelName, body] = match;
        const modelDef = modelDefs.get(modelName)!;
        parseModelRelations(modelDef, body, modelDefs);
    }
    
    // Third pass: parse policies, hooks, and extensions
    const blockRegex = /(policy|hook|extend)\s+([\w\.]+)\s*{((?:[^{}]|{(?:[^{}]|{[^{}]*})*})*)}/g;
    while((match = blockRegex.exec(uncommentedCode)) !== null) {
        const [, type, target, body] = match;
        const bodyContent = body.trim();
        
        const [modelName, subTarget] = target.split('.');
        const modelDef = modelDefs.get(modelName);

        if (!modelDef) {
            throw new Error(`Cannot apply '${type}' to unknown model "${modelName}".`);
        }

        if (type === 'policy') {
            const action = subTarget as PolicyAction;
            modelDef.policies[action] = { action, handler: () => false, handlerSource: bodyContent };
        } else if (type === 'hook') {
            const hookType = subTarget as HookType;
            modelDef.hooks.push({ type: hookType, handler: () => {}, handlerSource: bodyContent });
        } else if (type === 'extend') {
            const fullObjectSource = `({ ${bodyContent} })`;
            try {
                // We don't execute this, just need the source for the generator
                const methods = bodyContent.matchAll(/(\w+)\s*\(([^)]*)\)\s*\{/g);
                for(const methodMatch of methods) {
                    // This is a simplified parsing for the sandbox
                    const name = methodMatch[1];
                     modelDef.extensions.push({
                        name,
                        handler: () => {}, // Placeholder
                        handlerSource: `${name}${bodyContent.substring(bodyContent.indexOf('('))}`,
                    });
                }
            } catch (e: any) {
                throw new Error(`Syntax error in extend block for ${modelName}: ${e.message}`);
            }
        }
    }
    
    return Array.from(modelDefs.values());
}

/**
 * Main compiler function for the sandbox worker.
 * It takes DSL code and returns all generated artifacts.
 */
export function compileForSandbox(code: string): CompilationOutput {
    try {
        const models = parseForgeDsl(code);

        modelRegistry.clear();
        models.forEach(m => modelRegistry.registerModel(m));
        
        const allModels = modelRegistry.getAllModels();
        if (allModels.length === 0) {
            throw new Error("Compilation failed: No models were defined. Check your syntax for `model YourModel { ... }`.");
        }

        const ast = JSON.stringify(allModels, null, 2);
        const zodResult = generateZodSchemas(allModels);
        const migrationResult = generateMigrations(allModels, defaultConfig); // The actual schema
        const domainResult = generateDomainServices(allModels, defaultConfig);
        const rlsResult = generateRlsPolicies(allModels, defaultConfig);
        const routesResult = generateFastifyAdapter(allModels);

        return {
            ast: ast,
            zod: zodResult.content,
            sql: migrationResult.map(m => m.content).join('\n\n---\n\n'),
            domain: domainResult.content,
            rls: rlsResult,
            routes: routesResult.content,
            models: allModels,
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
