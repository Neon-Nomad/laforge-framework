import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAuthConfigFromEnv } from '../http/auth.js';

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
}

beforeEach(() => {
  resetEnv();
  vi.restoreAllMocks();
});

describe('loadAuthConfigFromEnv', () => {
  it('returns null when AUTH_PROVIDER is unset', () => {
    delete process.env.AUTH_PROVIDER;
    expect(loadAuthConfigFromEnv()).toBeNull();
  });

  it('warns and returns null for unsupported provider', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.AUTH_PROVIDER = 'kerberos';
    expect(loadAuthConfigFromEnv()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('requires AUTH_JWKS_URI when provider is oidc', () => {
    process.env.AUTH_PROVIDER = 'oidc';
    process.env.AUTH_ISSUER = 'https://issuer.test';
    process.env.AUTH_AUDIENCE = 'laforge-dev';
    expect(() => loadAuthConfigFromEnv()).toThrow('AUTH_JWKS_URI is required');
  });

  it('parses common env vars with defaults and lists', () => {
    process.env.AUTH_PROVIDER = 'mock';
    process.env.AUTH_ISSUER = 'https://issuer.test';
    process.env.AUTH_AUDIENCE = 'laforge-dev';
    process.env.AUTH_ROLE_CLAIM = 'groups';
    process.env.AUTH_TENANT_CLAIM = 'org';
    process.env.AUTH_ALLOWED_TENANTS = 't1, t2 ,t3';
    process.env.AUTH_REQUIRE_TENANT = 'true';

    const cfg = loadAuthConfigFromEnv();
    expect(cfg).toMatchObject({
      provider: 'mock',
      issuer: 'https://issuer.test',
      audience: 'laforge-dev',
      roleClaim: 'groups',
      tenantClaim: 'org',
      allowedTenants: ['t1', 't2', 't3'],
      requireTenant: true,
    });
  });
});
