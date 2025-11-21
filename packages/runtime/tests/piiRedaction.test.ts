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

  it('redacts fields supplied by getter even when env is empty', async () => {
    delete process.env.PII_FIELDS;
    delete process.env.ALLOW_PII_REVEAL;
    const server = Fastify();
    server.addHook('onSend', applyPiiRedaction(() => ['masked', 'secretToken']));
    server.get('/data', async () => ({ masked: 'hide-me', secretToken: 'super', ok: true }));

    const res = await server.inject({ method: 'GET', url: '/data' });
    const json = res.json() as any;
    expect(json.masked).toBe('***REDACTED***');
    expect(json.secretToken).toBe('***REDACTED***');
    expect(json.ok).toBe(true);
  });

  afterEach(() => {
    process.env.PII_FIELDS = originalEnv;
    delete process.env.ALLOW_PII_REVEAL;
  });
});
