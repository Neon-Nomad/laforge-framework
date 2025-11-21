import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { applyPiiRedaction } from '../http/controls.js';

describe('PII redaction middleware', () => {
  const originalEnv = process.env.PII_FIELDS;

  it('redacts configured fields in responses', async () => {
    process.env.PII_FIELDS = 'ssn,token';
    delete process.env.ALLOW_PII_REVEAL;
    const server = Fastify();
    server.addHook('onSend', applyPiiRedaction());
    server.get('/data', async () => ({ ssn: '111-11-1111', name: 'Alice', nested: { token: 'secret' } }));

    const res = await server.inject({ method: 'GET', url: '/data' });
    expect(res.statusCode).toBe(200);
    const json = res.json() as any;
    expect(json.ssn).toBe('***REDACTED***');
    expect(json.nested.token).toBe('***REDACTED***');
    expect(json.name).toBe('Alice');
  });

  afterEach(() => {
    process.env.PII_FIELDS = originalEnv;
    delete process.env.ALLOW_PII_REVEAL;
  });
});
