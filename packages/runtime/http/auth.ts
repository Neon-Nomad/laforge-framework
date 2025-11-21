import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
  type JWK,
  type JWTPayload,
  type KeyLike,
} from 'jose';
import type { UserContext } from '../index.js';

type AuthProvider = 'oidc' | 'mock';

export interface AuthConfig {
  provider: AuthProvider;
  issuer: string;
  audience: string;
  jwksUri?: string;
  roleClaim?: string;
  tenantClaim?: string;
  allowedTenants?: string[];
  requireTenant?: boolean;
}

export interface AuthenticatedUser extends UserContext {
  roles: string[];
  claims: Record<string, unknown>;
}

interface MockKeys {
  publicJwk: JWK;
  privateKey: KeyLike;
}

const MOCK_KID = 'laforge-mock';
let mockKeysPromise: Promise<MockKeys> | null = null;

const truthy = new Set(['1', 'true', 'yes', 'on']);

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return truthy.has(value.toLowerCase());
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const list = value
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

export function loadAuthConfigFromEnv(): AuthConfig | null {
  const providerRaw = process.env.AUTH_PROVIDER;
  if (!providerRaw) {
    return null;
  }

  const provider = providerRaw.toLowerCase() as AuthProvider;
  if (provider !== 'oidc' && provider !== 'mock') {
    console.warn(`Unsupported AUTH_PROVIDER "${providerRaw}", auth disabled.`);
    return null;
  }

  const issuer = process.env.AUTH_ISSUER ?? 'https://auth.laforge.local';
  const audience = process.env.AUTH_AUDIENCE ?? 'laforge-dev';
  const roleClaim = process.env.AUTH_ROLE_CLAIM ?? 'roles';
  const tenantClaim = process.env.AUTH_TENANT_CLAIM ?? 'tenant';
  const allowedTenants = parseList(process.env.AUTH_ALLOWED_TENANTS);
  const requireTenant = parseBool(process.env.AUTH_REQUIRE_TENANT, false);
  const jwksUri = process.env.AUTH_JWKS_URI;

  if (provider === 'oidc' && !jwksUri) {
    throw new Error('AUTH_JWKS_URI is required when AUTH_PROVIDER=oidc');
  }

  return {
    provider,
    issuer,
    audience,
    jwksUri,
    roleClaim,
    tenantClaim,
    allowedTenants,
    requireTenant,
  };
}

async function ensureMockKeys(): Promise<MockKeys> {
  if (!mockKeysPromise) {
    mockKeysPromise = generateKeyPair('RS256').then(async ({ publicKey, privateKey }) => {
      const publicJwk = (await exportJWK(publicKey)) as JWK;
      publicJwk.use = 'sig';
      publicJwk.alg = 'RS256';
      publicJwk.kid = MOCK_KID;
      return { publicJwk, privateKey };
    });
  }
  return mockKeysPromise;
}

function extractRoles(payload: JWTPayload, config: AuthConfig): string[] {
  const roleClaim = config.roleClaim ?? 'roles';
  const rawRoles = payload[roleClaim] ?? payload.role;
  if (Array.isArray(rawRoles)) {
    return rawRoles.map(r => String(r)).filter(Boolean);
  }
  if (typeof rawRoles === 'string') {
    return [rawRoles];
  }
  return ['user'];
}

function extractTenant(payload: JWTPayload, config: AuthConfig): string | undefined {
  const tenantClaim = config.tenantClaim ?? 'tenant';
  const candidates = [
    payload[tenantClaim],
    payload.tenant,
    payload.tenantId,
    (payload as any).org,
    (payload as any).org_id,
  ];
  const tenant = candidates.find(val => typeof val === 'string') as string | undefined;
  return tenant;
}

function collectClaims(payload: JWTPayload, reserved: Set<string>): Record<string, unknown> {
  const claims: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (reserved.has(key)) continue;
    if (['aud', 'exp', 'iat', 'iss', 'nbf', 'sub'].includes(key)) continue;
    claims[key] = value;
  }
  return claims;
}

function mapPayloadToUser(payload: JWTPayload, config: AuthConfig): AuthenticatedUser {
  const userId = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (!userId) {
    throw new Error('Token is missing subject (sub)');
  }

  const roles = extractRoles(payload, config);
  const tenantId = extractTenant(payload, config);

  if (config.requireTenant && !tenantId) {
    throw new Error('Token is missing tenant claim');
  }

  if (config.allowedTenants?.length && tenantId && !config.allowedTenants.includes(tenantId)) {
    throw new Error('Token tenant is not allowed');
  }

  const reservedClaims = new Set([
    'aud',
    'exp',
    'iat',
    'iss',
    'nbf',
    'sub',
    config.roleClaim ?? 'roles',
    config.tenantClaim ?? 'tenant',
  ]);

  return {
    id: userId,
    tenantId: tenantId ?? '',
    role: roles[0] ?? 'user',
    roles,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : undefined,
    claims: collectClaims(payload, reservedClaims),
  };
}

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization ?? request.headers.Authorization;
  if (typeof header !== 'string') {
    return null;
  }
  const [scheme, token] = header.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  return token.trim();
}

function createVerifier(config: AuthConfig) {
  if (config.provider === 'mock') {
    return ensureMockKeys().then(keys =>
      createLocalJWKSet({
        keys: [keys.publicJwk],
      }),
    );
  }
  return Promise.resolve(createRemoteJWKSet(new URL(config.jwksUri!)));
}

export function createAuthPreHandler(config: AuthConfig) {
  const verifierPromise = createVerifier(config);

  return async function authPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = extractBearerToken(request);
    if (!token) {
      reply.code(401).send({ error: 'Missing bearer token' });
      return;
    }

    try {
      const key = await verifierPromise;
      const { payload } = await jwtVerify(token, key, {
        issuer: config.issuer,
        audience: config.audience,
      });
      const user = mapPayloadToUser(payload, config);
      const tenantHeader = (request.headers['x-tenant-id'] as string | undefined) ?? (request.headers['tenant'] as string | undefined);
      if (tenantHeader && user.tenantId && tenantHeader !== user.tenantId) {
        reply.code(403).send({ error: 'Tenant mismatch' });
        return;
      }
      (request as any).user = user;
    } catch (error: any) {
      reply.code(401).send({ error: 'Unauthorized', details: error.message });
      return;
    }
  };
}

export async function issueMockToken(
  config: AuthConfig,
  overrides?: {
    sub?: string;
    tenantId?: string;
    omitTenant?: boolean;
    roles?: string[];
    claims?: Record<string, unknown>;
    expiresInSeconds?: number;
  },
): Promise<{ token: string; payload: JWTPayload; expiresIn: number }> {
  if (config.provider !== 'mock') {
    throw new Error('issueMockToken is only available when AUTH_PROVIDER=mock');
  }

  const { privateKey, publicJwk } = await ensureMockKeys();
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = overrides?.expiresInSeconds ?? 15 * 60; // 15 minutes
  const payload: JWTPayload = {
    sub: overrides?.sub ?? 'mock-user',
    iss: config.issuer,
    aud: config.audience,
    exp: now + expiresIn,
    iat: now,
    [config.roleClaim ?? 'roles']: overrides?.roles ?? ['admin'],
    ...(overrides?.claims ?? {}),
  };

  const tenantClaim = config.tenantClaim ?? 'tenant';
  if (!overrides?.omitTenant) {
    payload[tenantClaim] = overrides?.tenantId ?? 'mock-tenant';
  }

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid ?? MOCK_KID })
    .setExpirationTime(`${expiresIn}s`)
    .setIssuedAt(now)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .sign(privateKey);

  return { token, payload, expiresIn };
}
