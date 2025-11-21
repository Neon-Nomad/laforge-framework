type Labels = Record<string, string>;

interface CounterSeries {
  labels: Labels;
  value: number;
}

interface SummarySeries {
  labels: Labels;
  count: number;
  sum: number;
}

function labelsKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map(k => `${k}=${labels[k]}`)
    .join('|');
}

function formatLabels(labels: Labels): string {
  const entries = Object.keys(labels)
    .sort()
    .map(k => `${k}="${labels[k]}"`);
  return entries.length ? `{${entries.join(',')}}` : '';
}

class MetricsRegistry {
  private counters = new Map<string, { help: string; series: Map<string, CounterSeries> }>();
  private summaries = new Map<string, { help: string; series: Map<string, SummarySeries> }>();

  reset(): void {
    this.counters.clear();
    this.summaries.clear();
  }

  inc(name: string, labels: Labels = {}, help = ''): void {
    const seriesKey = labelsKey(labels);
    if (!this.counters.has(name)) {
      this.counters.set(name, { help, series: new Map() });
    }
    const metric = this.counters.get(name)!;
    if (!metric.series.has(seriesKey)) {
      metric.series.set(seriesKey, { labels, value: 0 });
    }
    metric.series.get(seriesKey)!.value += 1;
  }

  observe(name: string, value: number, labels: Labels = {}, help = ''): void {
    const seriesKey = labelsKey(labels);
    if (!this.summaries.has(name)) {
      this.summaries.set(name, { help, series: new Map() });
    }
    const metric = this.summaries.get(name)!;
    if (!metric.series.has(seriesKey)) {
      metric.series.set(seriesKey, { labels, count: 0, sum: 0 });
    }
    const ref = metric.series.get(seriesKey)!;
    ref.count += 1;
    ref.sum += value;
  }

  exportPrometheus(): string {
    const lines: string[] = [];
    for (const [name, metric] of this.counters.entries()) {
      lines.push(`# HELP ${name} ${metric.help || ''}`.trim());
      lines.push(`# TYPE ${name} counter`);
      const series = [...metric.series.values()].sort((a, b) => labelsKey(a.labels).localeCompare(labelsKey(b.labels)));
      for (const entry of series) {
        lines.push(`${name}${formatLabels(entry.labels)} ${entry.value}`);
      }
    }

    for (const [name, metric] of this.summaries.entries()) {
      lines.push(`# HELP ${name} ${metric.help || ''}`.trim());
      lines.push(`# TYPE ${name} summary`);
      const series = [...metric.series.values()].sort((a, b) => labelsKey(a.labels).localeCompare(labelsKey(b.labels)));
      for (const entry of series) {
        lines.push(`${name}_sum${formatLabels(entry.labels)} ${entry.sum}`);
        lines.push(`${name}_count${formatLabels(entry.labels)} ${entry.count}`);
      }
    }

    return lines.join('\n');
  }
}

export const metrics = new MetricsRegistry();

export function recordHttpRequest(
  source: 'runtime' | 'studio',
  route: string,
  method: string,
  status: number,
  durationMs: number,
): void {
  metrics.inc('laforge_http_requests_total', { source, route, method: method.toUpperCase(), status: String(status) }, 'HTTP requests total');
  metrics.observe(
    'laforge_http_request_duration_ms',
    durationMs,
    { source, route, method: method.toUpperCase() },
    'HTTP request duration (ms)',
  );
}

export function recordCompileDuration(durationMs: number): void {
  metrics.observe('laforge_compile_duration_ms', durationMs, { source: 'runtime' }, 'Compile duration (ms)');
}

export function recordModelOperation(model: string, operation: string, success: boolean): void {
  metrics.inc(
    'laforge_model_operations_total',
    { model, operation, success: success ? 'true' : 'false' },
    'Model CRUD operations',
  );
}

export function recordPolicyReject(model?: string, operation?: string): void {
  metrics.inc(
    'laforge_policy_rejects_total',
    { model: model || 'unknown', operation: operation || 'unknown' },
    'RBAC/ABAC rejects',
  );
}

export function recordMigrationDuration(db: string, appliedCount: number, durationMs: number): void {
  metrics.observe('laforge_migration_duration_ms', durationMs, { db }, 'Migration apply duration (ms)');
  metrics.inc('laforge_migrations_total', { db, applied: String(appliedCount) }, 'Migrations applied total');
}
