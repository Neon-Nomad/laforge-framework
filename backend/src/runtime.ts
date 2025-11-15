import { compileForSandbox } from './compiler/main.js';
import type { CompilationOutput } from './compiler/main.js';
import { DatabaseConnection } from './database.js';
import { v4 as uuidv4 } from 'uuid';
import vm from 'node:vm';
import ts from 'typescript';

export interface UserContext {
  id: string;
  tenantId: string;
  role: string;
  [key: string]: any;
}

export interface DomainContext {
  user: UserContext;
  db: DatabaseConnection;
  audit: AuditLogger;
}

export class AuditLogger {
  private logs: any[] = [];

  record(operation: string, data: any): void {
    this.logs.push({
      timestamp: new Date().toISOString(),
      operation,
      ...data
    });
  }

  getLogs(): any[] {
    return this.logs;
  }

  clear(): void {
    this.logs = [];
  }
}

export class LaForgeRuntime {
  private db: DatabaseConnection;
  private compiledCode: CompilationOutput | null = null;
  private domainServices: any = {};
  private zodSchemas: any = {};
  private sqlQueries: any = {};

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  // Compile DSL and set up the runtime
  async compile(dsl: string): Promise<CompilationOutput> {
    console.log('🔥 Compiling DSL with LaForge...');
    
    // Use the ACTUAL LaForge compiler
    this.compiledCode = compileForSandbox(dsl);
    
    console.log(`✅ Compiled ${this.compiledCode.models.length} models`);
    
    // Execute the SQL to create tables
    console.log('📊 Creating database schema...');
    try {
      // Convert PostgreSQL syntax to SQLite
      const sqliteSql = this.compiledCode.sql
        .replace(/UUID/g, 'TEXT')
        .replace(/VARCHAR\(\d+\)/g, 'TEXT')
        .replace(/TIMESTAMP WITH TIME ZONE/g, 'TEXT')
        .replace(/JSONB/g, 'TEXT')
        .replace(/BOOLEAN/g, 'INTEGER')
        .replace(/uuid_generate_v4\(\)/g, '(uuid_generate_v4())')
        .replace(/now\(\)/g, '(datetime(\'now\'))')
        .replace(/DEFAULT "(.*?)"/g, 'DEFAULT \'$1\'');
      
      this.db.exec(sqliteSql);
      console.log('✅ Database schema created');
    } catch (error: any) {
      console.error('❌ Schema creation error:', error.message);
      throw error;
    }

    // Dynamically evaluate the generated Zod schemas
    console.log('🔍 Loading Zod schemas...');
    try {
      const zodModule = this.evaluateModule(this.compiledCode.zod, ['zod']);
      this.zodSchemas = zodModule.exports;
      console.log(`✅ Loaded ${Object.keys(this.zodSchemas).length} Zod schemas`);
    } catch (error: any) {
      console.error('❌ Zod schema error:', error.message);
      throw error;
    }

    // Dynamically evaluate the generated SQL queries
    console.log('📝 Loading SQL queries...');
    try {
      const sqlModule = this.evaluateModule(this.compiledCode.domain, ['zod', 'sql']);
      this.sqlQueries = sqlModule.exports;
    } catch (error: any) {
      console.warn('⚠️  SQL queries partial load:', error.message);
    }

    // Dynamically evaluate the generated domain services
    console.log('🏗️  Loading domain services...');
    try {
      const domainModule = this.evaluateModule(this.compiledCode.domain, ['zod', 'sql']);
      this.domainServices = domainModule.exports;
      console.log(`✅ Loaded ${Object.keys(this.domainServices).length} domain services`);
    } catch (error: any) {
      console.error('❌ Domain service error:', error.message);
      console.error('Generated code:', this.compiledCode.domain.substring(0, 500));
      throw error;
    }

    return this.compiledCode;
  }

  // Evaluate generated code in a safe context
  private evaluateModule(code: string, dependencies: string[]): { exports: any } {
    const sandbox: any = {
      exports: {},
      module: { exports: {} },
      require: (name: string) => {
        if (name === 'zod') return require('zod');
        if (name === './zod') return this.zodSchemas || {};
        if (name === './sql') return this.sqlQueries || {};
        throw new Error(`Blocked require: ${name}`);
      },
      console,
      Date,
      String,
      Number,
      Boolean,
      Array,
      Object,
      JSON,
      Math,
      Promise,
      Error,
      AuthorizationError: class extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'AuthorizationError';
        }
      }
    };
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.process = undefined;
    sandbox.Buffer = undefined;

    vm.createContext(sandbox);

    try {
      const transpiled = ts.transpileModule(code, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true,
        },
      });
      const wrapperCode = `
        (function(exports, module, require, console, global, globalThis) {
          "use strict";
          ${transpiled.outputText}
          return module.exports;
        })
      `;
      const script = new vm.Script(wrapperCode, { filename: 'laforge-generated.js' });
      const fn = script.runInContext(sandbox);
      const result = fn(
        sandbox.exports,
        sandbox.module,
        sandbox.require,
        sandbox.console,
        sandbox,
        sandbox
      );
      return { exports: result || sandbox.module.exports };
    } catch (error: any) {
      console.error('Code evaluation error:', error.message);
      throw error;
    }
  }

  // Execute a CRUD operation using the generated domain services
  async execute(
    modelName: string,
    operation: 'create' | 'findById' | 'update' | 'delete' | 'list',
    user: UserContext,
    data: any = {}
  ): Promise<any> {
    if (!this.compiledCode) {
      throw new Error('Runtime not compiled. Call compile() first.');
    }

    const serviceName = `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}Domain`;
    const service = this.domainServices[serviceName];

    if (!service) {
      throw new Error(`Domain service not found: ${serviceName}. Available: ${Object.keys(this.domainServices).join(', ')}`);
    }

    const audit = new AuditLogger();
    const ctx: DomainContext = {
      user,
      db: this.db,
      audit
    };

    console.log(`🎯 Executing ${operation} on ${modelName} as user ${user.id} (${user.role})`);

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
          result = await service.list(ctx);
          break;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      console.log(`✅ Operation successful`);
      
      return {
        success: true,
        data: result,
        auditLog: audit.getLogs()
      };
    } catch (error: any) {
      console.log(`❌ Operation failed: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        errorType: error.name,
        auditLog: audit.getLogs()
      };
    }
  }

  getCompiledCode(): CompilationOutput | null {
    return this.compiledCode;
  }
}
