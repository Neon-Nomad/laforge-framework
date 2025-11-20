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
});
