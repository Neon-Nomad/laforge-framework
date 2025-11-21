import { describe, expect, it, beforeEach } from 'vitest';
import {
  metrics,
  recordCompileDuration,
  recordHttpRequest,
  recordModelOperation,
  recordPolicyReject,
  recordMigrationDuration,
} from '../metrics.js';

const contains = (output: string, fragment: string) => output.replace(/\s+/g, ' ').includes(fragment.replace(/\s+/g, ' '));

describe('metrics registry', () => {
  beforeEach(() => {
    metrics.reset();
  });

  it('exports counters and summaries in Prometheus format', () => {
    recordHttpRequest('runtime', '/health', 'GET', 200, 12);
    recordHttpRequest('runtime', '/health', 'GET', 200, 8);
    recordCompileDuration(42);
    recordModelOperation('Post', 'create', true);
    recordPolicyReject('Post', 'delete');
    recordMigrationDuration('postgres', 2, 128);

    const out = metrics.exportPrometheus();

    expect(contains(out, 'laforge_http_requests_total{method="GET",route="/health",source="runtime",status="200"} 2')).toBe(true);
    expect(contains(out, 'laforge_http_request_duration_ms_sum{method="GET",route="/health",source="runtime"}')).toBe(true);
    expect(contains(out, 'laforge_compile_duration_ms_sum{source="runtime"} 42')).toBe(true);
    expect(contains(out, 'laforge_model_operations_total{model="Post",operation="create",success="true"} 1')).toBe(true);
    expect(contains(out, 'laforge_policy_rejects_total{model="Post",operation="delete"} 1')).toBe(true);
    expect(contains(out, 'laforge_migration_duration_ms_sum{db="postgres"} 128')).toBe(true);
    expect(contains(out, 'laforge_migrations_total{applied="2",db="postgres"} 1')).toBe(true);
  });
});
