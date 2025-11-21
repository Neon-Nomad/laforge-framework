import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createAuthPreHandler, issueMockToken, type AuthConfig } from '../http/auth.js';

const baseConfig: AuthConfig = {
  provider: 'mock',
  issuer: 'https://mock.laforge.test',
  audience: 'laforge-dev',
  roleClaim: 'roles',
  tenantClaim: 'tenant',
  requireTenant: true,
};

function createReplyStub() {
  const reply: Partial<FastifyReply> & { statusCode?: number; payload?: unknown } = {};
  reply.code = vi.fn(code => {
    reply.statusCode = code;
    return reply as FastifyReply;
  });
  reply.send = vi.fn(payload => {
    reply.payload = payload;
    return reply as FastifyReply;
  });
  return reply as FastifyReply & { statusCode?: number; payload?: unknown };
}

describe('auth pre-handler (mock provider)', () => {
  it('attaches user from a valid mock token', { timeout: 20000 }, async () => {
    const { token } = await issueMockToken(baseConfig, {
      sub: 'user-123',
      tenantId: 'tenant-1',
      roles: ['admin', 'editor'],
      claims: { email: 'test@example.com', team: 'core' },
    });

    const request = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as FastifyRequest;
    const reply = createReplyStub();
    const preHandler = createAuthPreHandler(baseConfig);

    await preHandler(request, reply);

    expect((request as any).user).toMatchObject({
      id: 'user-123',
      tenantId: 'tenant-1',
      role: 'admin',
      roles: ['admin', 'editor'],
      claims: expect.objectContaining({ team: 'core' }),
    });
    expect(reply.statusCode).toBeUndefined();
  });

  it('rejects when tenant is required but missing', { timeout: 20000 }, async () => {
    const { token } = await issueMockToken(baseConfig, {
      sub: 'user-456',
      omitTenant: true,
    });

    const request = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as FastifyRequest;
    const reply = createReplyStub();
    const preHandler = createAuthPreHandler(baseConfig);

    await preHandler(request, reply);

    expect(reply.statusCode).toBe(401);
    expect((request as any).user).toBeUndefined();
  });

  it('rejects an expired token', { timeout: 20000 }, async () => {
    const { token } = await issueMockToken(baseConfig, { sub: 'expired', tenantId: 'tenant-1', expiresInSeconds: -60 });
    const request = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as FastifyRequest;
    const reply = createReplyStub();
    const preHandler = createAuthPreHandler(baseConfig);

    await preHandler(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toMatchObject({ error: 'Unauthorized' });
  });

  it('enforces tenant header mismatch with 403', { timeout: 20000 }, async () => {
    const { token } = await issueMockToken(baseConfig, { sub: 'user-tenant', tenantId: 'tenant-a' });
    const request = {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': 'tenant-b' },
    } as unknown as FastifyRequest;
    const reply = createReplyStub();
    const preHandler = createAuthPreHandler(baseConfig);

    await preHandler(request, reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toMatchObject({ error: 'Tenant mismatch' });
  });
});
