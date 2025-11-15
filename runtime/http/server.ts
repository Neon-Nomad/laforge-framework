import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getDatabase } from '../db/database.js';
import { LaForgeRuntime } from '../index.js';
import type { ModelDefinition, HookDefinition } from '../../compiler/ast/types.js';

const server = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

// Allow API clients to call the compiler runtime
await server.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

// Initialize database and runtime
const db = getDatabase();
let runtime = new LaForgeRuntime(db);

console.log('\nLaForge API server starting...\n');

// Health check
server.get('/health', async () => ({ status: 'ok', message: 'LaForge Backend is running!' }));

// Compile DSL endpoint
server.post<{
  Body: { dsl: string };
}>('/api/compile', async (request, reply) => {
  try {
    const { dsl } = request.body;

    if (!dsl || typeof dsl !== 'string') {
      return reply.code(400).send({
        success: false,
        error: 'DSL code is required',
      });
    }

    server.log.info('Received compilation request');

    runtime = new LaForgeRuntime(db);
    const compiledOutput = await runtime.compile(dsl);

    server.log.info(`Compilation successful: ${compiledOutput.models.length} models`);

    return {
      success: true,
      output: compiledOutput,
      message: `Successfully compiled ${compiledOutput.models.length} models`,
    };
  } catch (error: any) {
    server.log.error('Compilation failed:', error.message);

    return reply.code(400).send({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

// Execute CRUD operation endpoint
server.post<{
  Body: {
    modelName: string;
    operation: 'create' | 'findById' | 'update' | 'delete' | 'list';
    user: { id: string; tenantId: string; role: string };
    data?: any;
  };
}>('/api/execute', async (request, reply) => {
  try {
    const { modelName, operation, user, data } = request.body;

    if (!modelName || !operation || !user) {
      return reply.code(400).send({
        success: false,
        error: 'modelName, operation, and user are required',
      });
    }

    server.log.info(`Executing ${operation} on ${modelName}`);

    const result = await runtime.execute(modelName, operation, user, data);

    if (result.success) {
      server.log.info(`${operation} successful`);
    } else {
      server.log.warn(`${operation} failed: ${result.error}`);
    }

    return result;
  } catch (error: any) {
    server.log.error('Execution failed:', error.message);

    return reply.code(500).send({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

// Get current runtime state
server.get('/api/runtime/state', async () => {
  const compiledCode = runtime.getCompiledCode();

  if (!compiledCode) {
    return {
      compiled: false,
      message: 'No DSL has been compiled yet',
    };
  }

  return {
    compiled: true,
    models: compiledCode.models.map((model: ModelDefinition) => ({
      name: model.name,
      fields: Object.keys(model.schema),
      policies: Object.keys(model.policies),
      hooks: model.hooks.map((hook: HookDefinition) => hook.type),
    })),
  };
});

const start = async () => {
  try {
    await server.listen({ port: 3001, host: '0.0.0.0' });

    console.log('\nServer ready!\n');
    console.log('Endpoints:');
    console.log('   POST /api/compile        - Compile DSL');
    console.log('   POST /api/execute        - Execute CRUD operations');
    console.log('   GET  /api/runtime/state  - Get runtime state');
    console.log('   GET  /health             - Health check');
    console.log('\nListening on http://localhost:3001\n');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
