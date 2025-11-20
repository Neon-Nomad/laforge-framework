
// --- DSL Types ---

export type FieldType = "uuid" | "string" | "text" | "integer" | "boolean" | "datetime" | "jsonb" | "json";

export type RelationType = 'belongsTo' | 'hasMany' | 'manyToMany';

export interface Relation<T extends RelationType> {
    __typeName: 'Relation';
    type: T;
    targetModelName: string;
    onDelete?: 'cascade' | 'restrict' | 'set null' | 'no action';
}

export interface FieldOptions {
  type: FieldType;
  primaryKey?: boolean;
  tenant?: boolean;
  default?: string; // Raw SQL default value, e.g., "now()" or "uuid_generate_v4()"
  optional?: boolean;
  unique?: boolean;
}

export type ModelSchema = Record<string, FieldType | FieldOptions | Relation<RelationType>>;

// --- RBAC ---

export interface PermissionRule {
  roles: string[];
  claims: string[];
  condition?: string;
}

// --- Type Inference Helpers ---

type ResolveFieldType<T> = T extends "uuid" | "string" | "text"
  ? string
  : T extends "integer"
  ? number
  : T extends "boolean"
  ? boolean
  : T extends "datetime"
  ? Date
  : T extends "jsonb"
  ? any
  : never;

type ResolveField<T> = T extends FieldType
  ? ResolveFieldType<T>
  : T extends FieldOptions
  ? ResolveFieldType<T['type']>
  : never;
  
type IsOptional<T> = T extends FieldOptions ? T['optional'] extends true ? true : false : false;

export type Infer<S extends ModelSchema> = {
  -readonly [K in keyof S as IsOptional<S[K]> extends true ? never : S[K] extends Relation<RelationType> ? never : K]: ResolveField<S[K]>;
} & {
  -readonly [K in keyof S as IsOptional<S[K]> extends true ? K : never]?: ResolveField<S[K]>;
};


// --- Policy Context ---

export interface UserContext {
  id: string;
  tenantId: string;
  role: string;
  roles?: string[];
  scopes?: string[];
  email?: string;
  claims?: Record<string, unknown>;
  [key: string]: any;
}

export interface PolicyContext<S extends ModelSchema> {
  user: UserContext;
  record: Infer<S>;
}

export type PolicyHandler<S extends ModelSchema> = (
  context: PolicyContext<S>
) => boolean | Promise<boolean>;

export type PolicyAction = "create" | "read" | "update" | "delete";

// --- Hooks and Extensions ---

export type HookType = 'beforeCreate' | 'afterCreate' | 'beforeUpdate' | 'afterUpdate' | 'beforeDelete' | 'afterDelete';

export type HookHandler<S extends ModelSchema> = (
    payload: Partial<Infer<S>>, 
    context: any
) => Partial<Infer<S>> | void | Promise<Partial<Infer<S>> | void>;

export interface HookDefinition {
    type: HookType;
    handler: HookHandler<any>;
    handlerSource: string;
}

export type ExtensionHandler = (context: any, ...args: any[]) => any;

export interface ExtensionDefinition {
    name: string;
    handler: ExtensionHandler;
    handlerSource: string;
}

// --- Compiler Internals ---

export interface Model<TName extends string, TSchema extends ModelSchema> {
  __typeName: 'Model';
  name: TName;
  schema: TSchema;
}

export interface PolicyDefinition {
  action: PolicyAction;
  handler: PolicyHandler<any>;
  handlerSource: string;
}

export interface RelationDef {
    name: string; // e.g., "author"
    type: RelationType;
    targetModelName: string; // e.g., "User"
    foreignKey: string; // e.g., "authorId"
    through?: string; // For manyToMany, the join table name
    onDelete?: 'cascade' | 'restrict' | 'set null' | 'no action';
}

export interface ModelDefinition {
  name: string;
  schema: ModelSchema;
  relations: RelationDef[];
  policies: {
    [key in PolicyAction]?: PolicyDefinition;
  };
  hooks: HookDefinition[];
  extensions: ExtensionDefinition[];
  roles?: string[];
  claims?: string[];
  roleClaims?: Record<string, string[]>;
  permissions?: Partial<Record<PolicyAction, PermissionRule>>;
  rbacSpec?: ModelRbacSpec;
}

export type SupportedDb = 'postgres' | 'sqlite' | 'mysql';

export interface ForgeConfig {
  domain: string[];
  outDir: string;
  db: SupportedDb;
  dialect: 'postgres-rds'; // for future use
  audit: boolean;
  multiTenant: boolean;
  useSchemas?: boolean;
  migrations?: {
    allowDestructive?: boolean;
  };
}

export interface GenerationResult {
    filePath: string;
    content: string;
}
// --- RBAC ---

export interface CompiledPermissionRule {
  roles: string[];
  claims: string[];
  abacSql?: string;
}

export interface ModelRbacSpec {
  modelName: string;
  actions: {
    create?: CompiledPermissionRule;
    read?: CompiledPermissionRule;
    update?: CompiledPermissionRule;
    delete?: CompiledPermissionRule;
    list?: CompiledPermissionRule;
    [customAction: string]: CompiledPermissionRule | undefined;
  };
  raw?: Partial<Record<PolicyAction, PermissionRule>>;
}
