import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildStudioServer } from '../commands/studio.js';
import { metrics, recordPolicyReject, recordRateLimitBlock, recordWafBlock, recordPolicyChaosFailure } from '../../runtime/metrics.js';

describe('/api/studio/metrics', () => {
  beforeEach(() => {
    metrics.reset();
  });

  afterEach(async () => {
    metrics.reset();
  });

  it('returns security-related counters', async () => {
    recordWafBlock('pattern', '/api/test');
    recordRateLimitBlock('/api/test');
    recordPolicyReject('Post', 'create');
    recordPolicyChaosFailure('Post', 'delete');

    const server = await buildStudioServer({ baseDir: process.cwd(), port: 0 });
    const res = await server.inject({ method: 'GET', url: '/api/studio/metrics' });
    expect(res.statusCode).toBe(200);
    const json = res.json() as any;
    expect(json.counters['laforge_waf_blocks_total'][0].value).toBe(1);
    expect(json.counters['laforge_rate_limit_blocks_total'][0].value).toBe(1);
    expect(json.counters['laforge_policy_rejects_total'][0].value).toBe(1);
    expect(json.counters['laforge_policy_chaos_failures_total'][0].value).toBe(1);
  });
});
