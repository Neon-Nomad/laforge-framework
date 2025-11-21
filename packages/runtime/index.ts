import { compileForSandbox } from '../compiler/index.js';
import { generateSqlTemplates } from '../compiler/sql/sqlGenerator.js';
import type { CompilationOutput } from '../compiler/index.js';
import { DatabaseConnection } from './db/database.js';
import { AuditLogger } from './audit.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { withSpan } from './tracing.js';
import crypto from 'node:crypto';
export { runPolicyChaos } from './policyChaos.js';

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

export interface DomainContext {
  user: UserContext;
  db: DatabaseConnection;
  audit: AuditLogger;
}

const nodeRequire = createRequire(import.meta.url);

function toCamelCase(str: string): string {
  const pascal = str.replace(/(?:^|-|_)(\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, '');
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');
}

export class LaForgeRuntime {
  private db: DatabaseConnection;
  private compiledCode: CompilationOutput | null = null;
  private domainServices: any = {};
  private zodSchemas: any = {};
  private sqlQueries: any = {};
  private auditLogFile: string;

  constructor(db: DatabaseConnection | any) {
    if (db && typeof (db as any).query === 'function' && typeof (db as any).exec === 'function') {
      this.db = db as DatabaseConnection;
    } else if (db && typeof (db as any).prepare === 'function') {
      const filename = (db as any).name || ':memory:';
      this.db = new DatabaseConnection(filename);
    } else {
      throw new Error('Invalid database instance provided to LaForgeRuntime');
    }
    this.auditLogFile = process.env.LAFORGE_AUDIT_LOG || path.resolve('.laforge', 'audit', 'audit.ndjson');
  }

  async compile(dsl: string): Promise<CompilationOutput> {
    console.log('Compiling DSL with LaForge...');
    const compiled = compileForSandbox(dsl);
    await this.loadCompiled(compiled);
    return this.compiledCode!;
  }

  private normalizeSqlForSqlite(sql: string): string {
    return sql
      .replace(/UUID/g, 'TEXT')
      .replace(/VARCHAR\(\d+\)/g, 'TEXT')
      .replace(/TIMESTAMP WITH TIME ZONE/g, 'TEXT')
      .replace(/JSONB/g, 'TEXT')
      .replace(/BOOLEAN/g, 'INTEGER')
      .replace(/uuid_generate_v4\(\)/g, '(uuid_generate_v4())')
      .replace(/now\(\)/g, "(datetime('now'))")
      .replace(/id TEXT NOT NULL PRIMARY KEY(,?)/gi, 'id TEXT NOT NULL PRIMARY KEY DEFAULT (uuid_generate_v4())$1')
      .replace(/DEFAULT "(.*?)"/g, "DEFAULT '$1'");
  }

  private buildDomainModuleSource(compiled: CompilationOutput): string {
    const hasExplicitExports = /\bmodule\.exports\b|\bexport\s+/m.test(compiled.domain);
    const needsSnakeCaseHelper = !/function\s+toSnakeCase/.test(compiled.domain);

    const helper = needsSnakeCaseHelper
      ? `function toSnakeCase(str) { return str.replace(/[A-Z]/g, letter => \`_\${letter.toLowerCase()}\`).replace(/^_/, ''); }\n`
      : '';
    const domainSource = `${helper}${compiled.domain}`;

    if (hasExplicitExports) {
      return domainSource;
    }

    const domainNames = compiled.models.map(model => `${toCamelCase(model.name)}Domain`).filter(Boolean);
    if (domainNames.length === 0) {
      return domainSource;
    }

    return `${domainSource}\nmodule.exports = { ${domainNames.join(', ')} };`;
  }

  private buildSqlModule(compiled: CompilationOutput): any {
    const supplied = compiled.sqlQueries;
    const suppliedIsModule = typeof supplied === 'string' && /\b(export\s+|module\.exports)/.test(supplied);

    const sqlModuleSource =
      suppliedIsModule && supplied
        ? supplied
        : generateSqlTemplates(compiled.models, {
            multiTenant: compiled.config?.multiTenant ?? true,
            useSchemas: compiled.config?.useSchemas ?? false,
          }).content;

    const moduleResult = this.evaluateModule(sqlModuleSource, []);
    return moduleResult.exports;
  }

  private async verifyProvenance(compiledObject: CompilationOutput) {
    const provPath = process.env.PROVENANCE_PATH || path.resolve('.laforge', 'provenance.json');
    try {
      const stat = await fs.stat(provPath);
      if (!stat.isFile()) return;
      const body = await fs.readFile(provPath, 'utf8');
      const parsed = JSON.parse(body) as { compiledHash?: string };
      if (!parsed.compiledHash) return;
      const hash = crypto.createHash('sha256').update(JSON.stringify(compiledObject)).digest('hex');
      if (hash !== parsed.compiledHash) {
        throw new Error(`Provenance hash mismatch: expected ${parsed.compiledHash}, got ${hash}`);
      }
    } catch (err: any) {
      if (err?.code === 'ENOENT') return;
      throw err;
    }
  }

  async loadCompiled(compiledObject: CompilationOutput): Promise<CompilationOutput> {
    this.compiledCode = compiledObject;
    await this.verifyProvenance(compiledObject);

    console.log(`${compiledObject.models.length} models compiled`);
    console.log('Creating database schema...');
    try {
      const sqliteSql = this.normalizeSqlForSqlite(compiledObject.sql);
      this.db.exec(sqliteSql);
      console.log('database schema created');
    } catch (error: any) {
      console.error('Schema creation error:', error.message);
      throw error;
    }

    console.log('Loading SQL queries...');
    try {
      this.sqlQueries = this.buildSqlModule(compiledObject);
    } catch (error: any) {
      console.error('SQL queries load error:', error.message);
      throw error;
    }

    console.log('Loading Zod schemas...');
    try {
      const zodModule = this.evaluateModule(compiledObject.zod, ['zod']);
      this.zodSchemas = zodModule.exports;
      if (!this.zodSchemas || Object.keys(this.zodSchemas).length === 0) {
        throw new Error('Empty Zod schema export: no schemas were generated');
      }
      console.log(`Loaded ${Object.keys(this.zodSchemas).length} Zod schemas`);
    } catch (error: any) {
      console.error('Zod schema error:', error.message);
      throw error;
    }

    console.log('Loading domain services...');
    try {
      const domainSource = this.buildDomainModuleSource(compiledObject);
      const domainModule = this.evaluateModule(domainSource, ['zod', 'sql']);
      this.domainServices = domainModule.exports;
      if (!this.domainServices || Object.keys(this.domainServices).length === 0) {
        throw new Error('Domain services export missing or empty');
      }
      console.log(`Loaded ${Object.keys(this.domainServices).length} domain services`);
    } catch (error: any) {
      console.error('Domain service error:', error.message);
      if (compiledObject.domain) {
        console.error('Generated code:', compiledObject.domain.substring(0, 500));
      }
      throw new Error('Domain services export missing or invalid');
    }

    return this.compiledCode!;
  }

  async initializeFromGenerated(compiledPath: string = path.resolve('generated/compiled.json')): Promise<CompilationOutput> {
    const resolvedPath = path.resolve(compiledPath);
    let raw: string;

    try {
      raw = await fs.readFile(resolvedPath, 'utf8');
    } catch (error: any) {
      throw new Error(`Failed to read compiled output from ${resolvedPath}: ${error.message}`);
    }

    const parsed = JSON.parse(raw) as CompilationOutput;
    return this.loadCompiled(parsed);
  }

  private async defaultList(modelName: string, user: UserContext): Promise<any[]> {
    if (!this.compiledCode) {
      throw new Error('Runtime not compiled. Call compile() first.');
    }

    const model = this.compiledCode.models.find(m => m.name === modelName);
    if (!model) {
      throw new Error(`Model not found: ${modelName}`);
    }

    const tenantField = Object.keys(model.schema).find(field => {
      const opts = model.schema[field];
      return typeof opts === 'object' && opts && !(opts as any).__typeName && (opts as any).tenant;
    });

    const fields = Object.keys(model.schema).filter(key => {
      const value = model.schema[key] as any;
      return !(typeof value === 'object' && value && value.__typeName === 'Relation');
    });

    const tableName = `${toSnakeCase(model.name)}s`;
    const columns = fields.map(toSnakeCase).join(', ');
    const params: any[] = [];
    let query = `SELECT ${columns} FROM ${tableName}`;

    if (tenantField) {
      query += ` WHERE ${toSnakeCase(tenantField)} = $1`;
      params.push(user.tenantId);
    }

    const res = await this.db.query(query, params);
    const schemaName = `${model.name}Schema`;
    const schema = this.zodSchemas[schemaName];
    const rows = this.mapRowsToCamelCase(res.rows);
    return schema ? rows.map((row: any) => schema.parse(row)) : rows;
  }

  private mapRowsToCamelCase(rows: any[]): any[] {
    return rows.map(row => {
      if (!row || typeof row !== 'object') {
        return row;
      }
      const mapped: any = {};
      for (const [key, value] of Object.entries(row)) {
        const camelKey = toCamelCase(key);
        mapped[camelKey] = value;
      }
      return mapped;
    });
  }

  private evaluateModule(code: string, dependencies: string[]): { exports: any } {
    const normalize = (name: string) => (name === 'sql' ? './sql' : name);
    const allowedModules = new Set(['zod', './zod', './sql']);
    for (const dependency of dependencies || []) {
      const normalizedDependency = normalize(dependency);
      if (!allowedModules.has(normalizedDependency)) {
        throw new Error(`Sandbox dependency "${dependency}" is not permitted.`);
      }
    }

    const safeRequire = (request: string) => {
      const normalizedRequest = normalize(request);
      if (!allowedModules.has(normalizedRequest)) {
        throw new Error(`Blocked require("${request}") in sandbox.`);
      }
      if (normalizedRequest === './sql') {
        return this.sqlQueries;
      }

      if (normalizedRequest === './zod') {
        return this.zodSchemas;
      }

      if (normalizedRequest === 'zod') {
        return nodeRequire('zod');
      }

      throw new Error(`Unknown module: ${request}`);
    };

    const sandbox: any = {
      exports: {},
      module: { exports: {} },
      console,
      require: undefined,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      URL,
      URLSearchParams,
      AuditLogger,
      traceSpan: withSpan,
      AuthorizationError: class extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'AuthorizationError';
        }
      },
      Buffer: undefined,
      process: undefined,
      Function: undefined,
    };
    sandbox.exports = sandbox.module.exports;
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;

    vm.createContext(sandbox);

    try {
      const transpiled = ts.transpileModule(code, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true,
        },
      });
      let sanitizedCode = transpiled.outputText.replace(/^\uFEFF+/, '');
      sanitizedCode = sanitizedCode.replace(/^#!.*(\r?\n)/, '');
      sanitizedCode = sanitizedCode.replace(/^[\s\x00-\x1F]+/, '');

      if (/^require\(/m.test(sanitizedCode)) {
        throw new Error('Disallowed top-level require() detected before the sandbox wrapper.');
      }
      if (/new\s+Function\s*\(/.test(sanitizedCode) || /\bFunction\s*\(/.test(sanitizedCode)) {
        throw new Error('Blocked Function constructor escape attempt.');
      }

      const wrapperParts = [
        '(function(exports, module, require, console, global, globalThis) {',
        '"use strict";',
        sanitizedCode,
        'return module.exports;',
        '})',
      ];
      const wrapperCode = wrapperParts.join('\n');
      const script = new vm.Script(wrapperCode, { filename: 'laforge-generated.js' });
      const fn = script.runInContext(sandbox);
      const result = fn(
        sandbox.exports,
        sandbox.module,
        safeRequire,
        sandbox.console,
        sandbox.global,
        sandbox.globalThis,
      );
      const exportsValue = result || sandbox.module.exports;
      if (dependencies?.includes('zod') && exportsValue && Object.keys(exportsValue).length === 0) {
        throw new Error('Empty schema export: no Zod schemas were returned');
      }
      return { exports: exportsValue };
    } catch (error: any) {
      console.error('Code evaluation error:', error.message);
      throw error;
    }
  }

  async execute(
    modelName: string,
    operation: 'create' | 'findById' | 'update' | 'delete' | 'list',
    user: UserContext,
    data: any = {},
  ): Promise<any> {
    if (!this.compiledCode) {
      throw new Error('Runtime not compiled. Call compile() first.');
    }

    const serviceName = `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}Domain`;
    const service = this.domainServices[serviceName];

    if (!service) {
      throw new Error(
        `Domain service not found: ${serviceName}. Available: ${Object.keys(this.domainServices).join(', ')}`,
      );
    }

    const audit = new AuditLogger(this.db);
    const camelCaseDb = {
      exec: (sql: string) => this.db.exec(sql),
      query: async (text: string, params: any[] = []) => {
        const res = await this.db.query(text, params);
        return { rows: this.mapRowsToCamelCase(res.rows), rowCount: res.rowCount };
      },
    } as DatabaseConnection;
    const ctx: DomainContext = {
      user,
      db: camelCaseDb,
      audit,
    };

    const displayRole = user.role ?? user.roles?.[0] ?? 'unknown';
    console.log(`Executing ${operation} on ${modelName} as user ${user.id} (${displayRole})`);

    try {
      let result;

      switch (operation) {
        case 'create':
          result = await service.create(ctx, data);
          break;
        case 'findById':
          result = await service.findById(ctx, data.id);
          break;
        case 'update':
          result = await service.update(ctx, data.id, data);
          break;
        case 'delete':
          result = await service.delete(ctx, data.id);
          break;
        case 'list':
          if (typeof service.list === 'function') {
            result = await service.list(ctx);
          } else {
            result = await this.defaultList(modelName, user);
          }
          break;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      console.log('Operation successful');

      return {
        success: true,
        data: result,
        auditLog: audit.getLogs(),
      };
    } catch (error: any) {
      console.log(`Operation failed: ${error.message}`);

      return {
        success: false,
        error: error.message,
        errorType: error.name,
        auditLog: audit.getLogs(),
      };
    }
  }

  getCompiledCode(): CompilationOutput | null {
    return this.compiledCode;
  }
}
