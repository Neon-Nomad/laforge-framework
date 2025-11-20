# @laforge-dev/auto-migrate

Automatic Postgres migration verification for LaForge. This subsystem spins up a disposable database in Docker, applies a migration, classifies failures, and produces a repaired SQL script that can be re-run safely.

## How It Works

1. **Sandbox runner** — `spawnSandbox` launches `postgres:15` via Docker, waits for readiness, pipes the migration into `psql`, and captures stdout/stderr logs.
2. **Classifier** — `classifyErrors` inspects the Postgres logs for well-known failure modes (missing tables, FK violations, invalid defaults, blocked drops, etc.).
3. **Repair engine** — `repairMigration` generates helper statements (table stubs, `ALTER TABLE` fixes, FK reordering, DROP commenting, SAVEPOINT wrappers) to unblock the migration.
4. **Coordinator** — `runMigrationInSandbox` orchestrates the process and returns a structured `SandboxResult` with logs, detected errors, and repaired SQL.

## Usage

```ts
import { runMigrationInSandbox } from '@laforge-dev/auto-migrate';

const result = await runMigrationInSandbox(`
  ALTER TABLE posts ADD COLUMN rating integer;
  ALTER TABLE comments ADD CONSTRAINT comments_post_id_fkey
    FOREIGN KEY (post_id) REFERENCES posts(id);
`);

if (result.success) {
  console.log('Migration is safe 🎉');
} else {
  console.warn('Sandbox found issues:', result.errors);
  console.info('Auto-generated fallback SQL:\n', result.repairedSql);
}
```

### Returned Object

```ts
interface SandboxResult {
  success: boolean;
  logs: string[];
  errors?: ClassifiedError[];
  repairedSql?: string;
}
```

## Running Locally

> Docker Desktop (or compatible) must be available to run real sandbox checks.

```bash
# build just this package
npm run build:auto-migrate

# run the unit suite (mocks Docker)
npm run test:auto-migrate
```

Inside the package you can also use:

```bash
cd packages/auto-migrate
npm run build
npm run test
```

## Sample Output

```
success: false
logs:
  - ERROR: relation "posts" does not exist
errors:
  - { kind: 'missing_table', table: 'posts' }
repairedSql:
  -- Auto-migrate: create missing table "posts"
  CREATE TABLE IF NOT EXISTS "posts" (...);
  ALTER TABLE IF EXISTS "posts" ADD COLUMN IF NOT EXISTS "title" text;
```

Repaired SQL is intentionally verbose and idempotent so it can be inspected or committed as-is. Unknown failures fall back to wrapping the original SQL inside a SAVEPOINT guard to prevent partial application.
