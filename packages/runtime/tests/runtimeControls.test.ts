import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { applySecurityHeaders, createRateLimiter, createWafShield, parseRateLimit } from '../http/controls.js';

describe('rate limit parsing', () => {
  it('parses 100/min into window and max', () => {
    const parsed = parseRateLimit('100/min');
    expect(parsed.max).toBe(100);
    expect(parsed.windowMs).toBe(60_000);
  });

  it('falls back on invalid input', () => {
    const fallback = { windowMs: 10_000, max: 10 };
    const parsed = parseRateLimit('nonsense', fallback);
    expect(parsed).toMatchObject(fallback);
  });
});

describe('rate limiter + WAF middleware', () => {
  let server: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    server = Fastify();
    server.addHook('onRequest', createRateLimiter({ windowMs: 60_000, max: 5, key: () => 'test-key' }));
    server.addHook('preHandler', createWafShield());
    server.addHook('onSend', applySecurityHeaders());
    server.get('/ping', async () => ({ ok: true }));
    server.post('/echo', async request => ({ body: request.body }));
  });

  it('returns 429 after exceeding limit', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await server.inject({ method: 'GET', url: '/ping' });
      expect(res.statusCode).toBe(200);
    }
    const blocked = await server.inject({ method: 'GET', url: '/ping' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'rate_limited' });
  });

  it('blocks obvious WAF patterns', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/echo',
      payload: { q: '<script>alert(1)</script>' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'blocked' });
  });

  it('applies security headers on responses', async () => {
    const res = await server.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    const headers = res.headers;
    const gold = {
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'; script-src 'self'",
      'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'cross-origin-resource-policy': 'same-origin',
      'cross-origin-opener-policy': 'same-origin',
      'x-xss-protection': '1; mode=block',
    };
    for (const [key, value] of Object.entries(gold)) {
      expect(headers[key]).toBe(value);
    }
  });
});
