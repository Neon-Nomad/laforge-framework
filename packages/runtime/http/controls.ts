import type { FastifyReply, FastifyRequest } from 'fastify';
import { recordRateLimitBlock, recordWafBlock } from '../metrics.js';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  key?: (req: FastifyRequest) => string;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const defaultKey = (req: FastifyRequest) => (req.ip || 'unknown') + ':' + (req.routeOptions?.url || req.url);

export function parseRateLimit(value: string | undefined, fallback: RateLimitConfig = { windowMs: 60_000, max: 100 }): RateLimitConfig {
  if (!value) return fallback;
  const match = value.trim().match(/^(\d+)\s*\/\s*(s|sec|second|m|min|minute)$/i);
  if (!match) return fallback;
  const max = Number(match[1]);
  const unit = match[2].toLowerCase();
  const windowMs = unit.startsWith('s') ? 1000 : 60_000;
  return { windowMs, max, key: fallback.key };
}

export function createRateLimiter(config: RateLimitConfig) {
  const buckets = new Map<string, Bucket>();

  return async function rateLimiter(req: FastifyRequest, reply: FastifyReply) {
    const key = config.key ? config.key(req) : defaultKey(req);
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: config.max, updatedAt: now };

    const elapsed = now - bucket.updatedAt;
    if (elapsed > 0) {
      const refill = Math.floor((elapsed / config.windowMs) * config.max);
      if (refill > 0) {
        bucket.tokens = Math.min(config.max, bucket.tokens + refill);
        bucket.updatedAt = now;
      }
    }

    if (bucket.tokens < 1) {
      recordRateLimitBlock(req.routeOptions?.url || req.url);
      reply.code(429).send({ error: 'rate_limited', message: 'Too many requests' });
      return;
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
  };
}

const defaultWafPatterns = [
  /<\s*script/i,
  /union\s+select/i,
  /information_schema/i,
  /or\s+1\s*=\s*1/i,
];

export function createWafShield(patterns: RegExp[] = defaultWafPatterns) {
  return async function wafShield(req: FastifyRequest, reply: FastifyReply) {
    const candidates: string[] = [];

    const pushIfString = (val: unknown) => {
      if (typeof val === 'string') candidates.push(val);
      else if (Array.isArray(val)) val.forEach(pushIfString);
      else if (val && typeof val === 'object') Object.values(val as Record<string, unknown>).forEach(pushIfString);
    };

    pushIfString(req.query as any);
    pushIfString(req.body as any);
    pushIfString(req.params as any);

    if (candidates.some(text => patterns.some(p => p.test(text)))) {
      recordWafBlock('pattern_match', req.routeOptions?.url || req.url);
      reply.code(403).send({ error: 'blocked', message: 'Request blocked by WAF' });
      return;
    }
  };
}

export function applySecurityHeaders() {
  return async function securityHeaders(_req: FastifyRequest, reply: FastifyReply, payload: any) {
    reply.header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; script-src 'self'");
    reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('X-XSS-Protection', '1; mode=block');
    return payload;
  };
}

const redactionToken = '***REDACTED***';

function redactObject(obj: any, piiFields: Set<string>): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => redactObject(item, piiFields));
  const out: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (piiFields.has(key)) {
      out[key] = redactionToken;
    } else if (value && typeof value === 'object') {
      out[key] = redactObject(value, piiFields);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function applyPiiRedaction() {
  return async function redact(_req: FastifyRequest, _reply: FastifyReply, payload: any) {
    const envFields = (process.env.PII_FIELDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const revealAllowed = process.env.ALLOW_PII_REVEAL === 'true';
    if (!envFields.length || revealAllowed) {
      return payload;
    }
    const piiFields = new Set(envFields);
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload);
        const redacted = redactObject(parsed, piiFields);
        return JSON.stringify(redacted);
      } catch {
        return payload;
      }
    }
    return redactObject(payload, piiFields);
  };
}
