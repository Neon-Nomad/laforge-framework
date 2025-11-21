import { createRequire } from 'node:module';

type OtelApi = typeof import('@opentelemetry/api');

let cachedApi: OtelApi | null | undefined;

function getApi(): OtelApi | null {
  if (cachedApi !== undefined) return cachedApi;
  try {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedApi = require('@opentelemetry/api') as OtelApi;
  } catch {
    cachedApi = null;
  }
  return cachedApi;
}

export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean> | undefined,
  fn: () => Promise<T> | T,
): Promise<T> {
  const api = getApi();
  if (!api) {
    return await fn();
  }
  const tracer = api.trace.getTracer('laforge');
  const span = tracer.startSpan(name, { attributes });
  try {
    const result = await fn();
    span.setStatus({ code: api.SpanStatusCode.OK });
    return result;
  } catch (err: any) {
    span.recordException(err);
    span.setStatus({ code: api.SpanStatusCode.ERROR, message: err?.message });
    throw err;
  } finally {
    span.end();
  }
}
