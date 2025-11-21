import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getDatabase } from '../db/database.js';
import { LaForgeRuntime } from '../index.js';
import type { ModelDefinition, HookDefinition } from '../../compiler/ast/types.js';
import { createAuthPreHandler, issueMockToken, loadAuthConfigFromEnv } from './auth.js';
import { metrics, recordCompileDuration, recordHttpRequest, recordModelOperation, recordPolicyReject } from '../metrics.js';
import { withSpan } from '../tracing.js';

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
const authConfig = loadAuthConfigFromEnv();
const authPreHandler = authConfig ? createAuthPreHandler(authConfig) : null;

console.log('\nLaForge API server starting...\n');

server.addHook('onRequest', (request, _reply, done) => {
  (request as any).metricsStart = Date.now();
  done();
});

server.addHook('onResponse', (request, reply, done) => {
  const started = (request as any).metricsStart as number | undefined;
  const duration = started ? Date.now() - started : 0;
  const routeLabel = request.routeOptions?.url || request.url;
  recordHttpRequest('runtime', routeLabel, request.method, reply.statusCode, duration);
  done();
});

// Health check
server.get('/health', async () => ({ status: 'ok', message: 'LaForge Backend is running!' }));

// Readiness probe: verifies DB connectivity and compile state (if available)
server.get('/ready', async (_req, reply) => {
  try {
    const res = await db.query('SELECT 1 as ok');
    const compiled = !!runtime.getCompiledCode?.();
    reply.send({ status: 'ok', db: res.rows?.[0]?.ok === 1, compiled });
  } catch (err: any) {
    reply.code(503).send({ status: 'error', message: err?.message || 'unready' });
  }
});

// Metrics endpoint (Prometheus format)
server.get('/metrics', async (_req, reply) => {
  reply.header('Content-Type', 'text/plain; version=0.0.4').send(metrics.exportPrometheus());
});

if (authConfig?.provider === 'mock') {
  server.post<{
    Body?: { sub?: string; tenantId?: string; roles?: string[]; claims?: Record<string, unknown> };
  }>('/auth/mock/token', async request => {
    const result = await issueMockToken(authConfig, request.body);
    return { ...result, provider: 'mock' };
  });
}

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
    const started = Date.now();
    const compiledOutput = await withSpan('runtime.compile', { route: '/api/compile' }, async () => runtime.compile(dsl));
    recordCompileDuration(Date.now() - started);

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
    user?: { id: string; tenantId: string; role: string; roles?: string[]; scopes?: string[]; email?: string };
    data?: any;
  };
}>(
  '/api/execute',
  { preHandler: authPreHandler ? [authPreHandler] : [] },
  async (request, reply) => {
    try {
      const { modelName, operation, user, data } = request.body;
      const authenticatedUser = (request as any).user as
        | { id: string; tenantId: string; role: string; roles?: string[] }
        | undefined;
      const resolvedUser = authenticatedUser ?? user;

      if (!modelName || !operation) {
        return reply.code(400).send({
          success: false,
          error: 'modelName and operation are required',
        });
      }

      if (!resolvedUser) {
        return reply.code(authPreHandler ? 401 : 400).send({
          success: false,
          error: 'User context is required',
        });
      }

      const missingFields = ['id', 'tenantId', 'role'].filter(
        field => !(resolvedUser as any)[field],
      );
      if (missingFields.length > 0) {
        return reply.code(400).send({
          success: false,
          error: `Missing user fields: ${missingFields.join(', ')}`,
        });
      }

      const roleLabel = resolvedUser.role ?? resolvedUser.roles?.[0] ?? 'unknown';
      server.log.info(`Executing ${operation} on ${modelName} as ${resolvedUser.id} (${roleLabel})`);

      const result = await withSpan(
        'runtime.execute',
        { model: modelName, operation, user: resolvedUser.id },
        () => runtime.execute(modelName, operation, resolvedUser, data),
      );

      if (result.success) {
        server.log.info(`${operation} successful`);
        recordModelOperation(modelName, operation, true);
      } else {
        server.log.warn(`${operation} failed: ${result.error}`);
        recordModelOperation(modelName, operation, false);
        if (/permission|unauthorized/i.test(result.error || '')) {
          recordPolicyReject(modelName, operation);
        }
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
  },
);

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
