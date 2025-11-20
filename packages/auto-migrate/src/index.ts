import { classifyErrors } from './classifier';
import type { ClassifiedError, SandboxResult } from './contract';
import { repairMigration } from './repair';
import { spawnSandbox, SandboxRunError } from './sandbox';

export type { ClassifiedError, SandboxResult, ErrorKind } from './contract';
export { classifyErrors } from './classifier';
export { repairMigration } from './repair';
export { spawnSandbox } from './sandbox';

export async function runMigrationInSandbox(migrationSql: string): Promise<SandboxResult> {
  let logs: string[] = [];

  try {
    logs = await spawnSandbox(migrationSql);
  } catch (error) {
    const sandboxError = error instanceof SandboxRunError ? error : undefined;
    if (sandboxError?.logs?.length) {
      logs = sandboxError.logs;
    }
    const classified = classifyErrors(logs);
    const errors = classified.length > 0 ? classified : [toUnknownError(sandboxError)];
    const repairedSql = repairMigration(migrationSql, errors);
    return {
      success: false,
      logs,
      errors,
      repairedSql,
    };
  }

  const errors = classifyErrors(logs);
  if (errors.length === 0) {
    return { success: true, logs };
  }

  return {
    success: false,
    logs,
    errors,
    repairedSql: repairMigration(migrationSql, errors),
  };
}

function toUnknownError(error: Error | undefined): ClassifiedError {
  return {
    kind: 'unknown',
    message: error?.message ?? 'Migration failed in sandbox',
  };
}
