# LaForge

LaForge is a policy-first backend compiler that generates schemas, RLS policies, services, routes, and migrations from a single domain definition.

## Project Layout

```
laforge/
  compiler/       # AST, parser, codegen, SQL, RLS, diffing
  runtime/        # DB adapters, HTTP runtime, validation hooks
  cli/            # forge CLI entrypoint + commands
  examples/       # sample domains
  tests/          # vitest suite
  docs/           # handbook and deep dives
```

## Quickstart

```
npm install
npm run build

# Compile a domain (no files written)
forge compile examples/simple-blog/domain.ts

# Generate artifacts
forge generate examples/simple-blog/domain.ts
ls examples/simple-blog/generated

# Run tests
npm test

# CLI help
forge --help
```

## DSL Example

```ts
model User {
  id: uuid pk
  tenantId: uuid tenant
  email: string
  role: string
}

model Post {
  id: uuid pk
  tenantId: uuid tenant
  title: string
  body: text
  author: belongsTo(User)
}

policy Post.read {
  record.tenantId == user.tenantId || user.role === "admin"
}

hook Post.beforeCreate {
  record.slug = record.title.toLowerCase().replace(/\s+/g, '-')
}
```

## Example Output

- **SQL schema**
  ```sql
  CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    author_id UUID
  );
  ```
- **RLS policy**
  ```sql
  CREATE POLICY post_read_tenant_scope
  ON posts
  USING ((tenant_id = current_setting('app.tenant_id')::uuid));
  ```
- **Zod types**
  ```ts
  export const PostSchema = zod.object({
    id: zod.string().uuid(),
    tenantId: zod.string().uuid(),
    title: zod.string(),
    body: zod.string(),
    authorId: zod.string().uuid().optional(),
  });
  ```
- **Migration**
  ```sql
  -- migrations/20240101010101_initial_schema.sql
  CREATE TABLE IF NOT EXISTS users (...);
  CREATE TABLE IF NOT EXISTS posts (...);
  ALTER TABLE posts ADD CONSTRAINT fk_posts_author_id ...
  ```

## CLI Commands

- `forge compile <domain-file>` – validate and compile a domain definition.
- `forge generate <domain-file>` – emit SQL, services, routes, and migrations under `<domain>/generated` (or `--out`).
- `forge diff <old-domain> <new-domain>` – show schema-aware diffs between two domain definitions (`--json` available).
- `forge migrate` – apply pending migrations under `.laforge/migrations` (supports `--dry-run`, `--check`, `--to`).
- `forge status` – show applied vs. pending migrations.
- `forge test` – run the Vitest suite.

All commands run locally in Node.js—no browser or DOM runtime required.

## Schema-aware diff engine

- Detects table/column adds, drops, renames.
- Tracks type, nullability, and default changes.
- Detects foreign key adds/removals/changes.
- Emits safe-mode warnings when destructive changes are blocked.

## Using `forge diff`

```
forge diff examples/old-blog/domain.ts examples/simple-blog/domain.ts
```

Sample output (colors enabled in TTY):
```
+ add table posts (id UUID, title VARCHAR(255), author_id UUID)
~ rename column posts.title -> headline
~ alter nullability posts.body: nullable -> not_null
! drop column posts.temp_value
```

## CI examples with `--json`

```
forge diff --json examples/old-blog/domain.ts examples/simple-blog/domain.ts
```

Produces a stable JSON payload:
```json
{
  "schema": {
    "operations": [
      { "kind": "addTable", "table": "posts", "columns": ["... trimmed ..."] },
      { "kind": "renameColumn", "table": "posts", "from": "title", "to": "headline" }
    ],
    "warnings": []
  },
  "sqlDiff": "+ ALTER TABLE posts RENAME COLUMN title TO headline;"
}
```

## Destructive mode vs safe mode

- Default: `migrations.allowDestructive = false`
  - Table/column drops become warnings.
  - Dangerous type changes are skipped with warnings.
  - Migration still runs for safe changes.
- Destructive mode: set `"migrations": { "allowDestructive": true }` in config
  - Full DROP/TYPE changes are emitted.

## Migration baseline and state

LaForge persists schema state and migrations in `.laforge/`:

```
.laforge/
  schema.json          # last known schema snapshot
  migrations/
    20250201_150203_add_field.sql
    state.json         # applied migration log
```

`forge generate` compares the current domain to `schema.json`, writes the next migration into `.laforge/migrations/`, and updates the snapshot. `forge migrate` applies pending migrations to the target database (SQLite by default, configurable with `--db`). `forge status` reports applied vs. pending.

CI examples:
- `forge migrate --check` fails if pending migrations exist.
- `forge migrate --dry-run` shows pending migrations without applying.

## Handbook

Full docs live at `docs/HANDBOOK.md`:
- Why LaForge exists and architecture overview
- DSL guide and compiler pipeline
- Migration workflow and state files
- Multi-DB adapters (Postgres, MySQL, SQLite)
- CLI commands and examples
- Plugin guide (lifecycle/events/output hooks)
- Runtime API overview

## Guarantees

- Zero-drift SQL + migrations derived from the same AST as generated code.
- Reversible, timestamped migrations for safe deployment.
- AST-verified RLS output to prevent policy injection.
- Multi-tenant safe defaults (tenant isolation baked into schema and policies).
- Generated domain services and routes aligned with the compiled schema.

## Roadmap to v1.0

- ✅ Backend-only compiler and runtime
- ✅ CLI for compile/generate/diff/test
- ✅ Simple example domain
- 🚧 Harden parser, validation, and schema diff/migration pipeline
- 🚧 Add more real-world examples and migration strategies
- 🚧 Publish ecosystem tooling (language server, VS Code snippets)

## Contributing

Issues and PRs are welcome. Please keep the repository backend-only—no DOM, React, or playground dependencies.
