import type { LaForgeRuntime } from './index.js';
import { recordPolicyChaosFailure } from './metrics.js';

export type ChaosExpectation = 'allow' | 'deny';

export interface ChaosUser {
  id: string;
  tenantId: string;
  role: string;
  roles?: string[];
  claims?: Record<string, unknown>;
  scopes?: string[];
}

export interface ChaosCase {
  model: string;
  operation: 'create' | 'read' | 'update' | 'delete' | 'list' | 'findById';
  user: ChaosUser;
  data?: any;
  expect: ChaosExpectation;
  note?: string;
}

export interface ChaosResult {
  total: number;
  failures: Array<{ test: ChaosCase; result: { success: boolean; error?: string } }>;
}

export async function runPolicyChaos(runtime: LaForgeRuntime, tests: ChaosCase[]): Promise<ChaosResult> {
  const failures: ChaosResult['failures'] = [];

  for (const t of tests) {
    const mappedOperation =
      t.operation === 'read'
        ? 'findById'
        : t.operation;
    const res = await runtime.execute(t.model, mappedOperation, t.user, t.data);
    const shouldAllow = t.expect === 'allow';
    if (shouldAllow !== res.success) {
      failures.push({ test: t, result: { success: res.success, error: res.error } });
      recordPolicyChaosFailure(t.model, t.operation);
    }
  }

  return { total: tests.length, failures };
}
