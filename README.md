<h1 align="center">Ã¢Å¡Â¡ LaForge Ã¢Å¡Â¡</h1>
<h3 align="center">The Policy-First Backend Compiler</h3>
<h4 align="center">Stop building backends. Start compiling them.</h4>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Active-brightgreen" />
  <img src="https://img.shields.io/badge/Zero%20Drift-Guaranteed-red" />
  <img src="https://img.shields.io/badge/DB-Postgres%20%7C%20MySQL%20%7C%20SQLite-orange" />
  <img src="https://img.shields.io/badge/Security-Policy%20First-critical" />
  <img src="https://img.shields.io/github/stars/Neon-Nomad/laforge-framework?style=social" />
  <img src="https://img.shields.io/badge/Language-TypeScript-yellow" />
  <img src="https://img.shields.io/badge/License-MIT-green" />
  <img src="https://img.shields.io/github/last-commit/Neon-Nomad/laforge-framework" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Category-Backend%20Compiler-blueviolet" />
  <img src="https://img.shields.io/badge/Generation-Full%20Backend-orange" />
  <img src="https://img.shields.io/badge/CI-Safe%20Migrations-blue" />
</p>

---

<p align="center">
  Ã°Å¸â€Â¥ Compile your entire backend Ã¢â‚¬â€ schema, migrations, policies, validators, routes, and services Ã¢â‚¬â€ from a single domain file.
</p>

<p align="center">
  <b>LaForge: A Policy-First Backend Compiler for Serious Engineering Teams</b>
</p>

LaForge replaces traditional ORMs and schema-drift-prone backends by giving engineers a single source of truth: a domain DSL. From that DSL, LaForge deterministically generates:
- SQL schema
- RLS (Row-Level Security) policies
- Zod validation schemas
- Typed domain services
- REST routes
- Incremental migrations
- A secure runtime for model-aware CRUD

Core Guarantees (post-hardening)
- Zero drift: AST = schema = code = migration.
- Multi-DB consistency: Postgres/MySQL/SQLite align on UUIDs, JSON, uniques, and FK behavior.
- Deterministic migrations: rename detection, type reversions via ALTER, and strict destructive-op blocking.
- Security by default: policies validated at compile time; unsupported user refs rejected; template literals disallowed; duplicate policy conflicts detected.
- Sandboxed runtime: `new Function()` blocked; `require('fs')` blocked; missing domain services or Zod exports fail fast.
- Hardened tests: stress coverage for cycles, multi-hop FKs, cross-DB consistency, destructive-migration protection, sandbox isolation.

LaForge is not an ORM. ItÃ¢â‚¬â„¢s a compiler for your backend.

## Project Layout

```
laforge/
  compiler/       # AST, parser, codegen, SQL, RLS, diffing
  runtime/        # DB adapters, HTTP runtime, validation hooks
  cli/            # forge CLI entrypoint + commands
  examples/       # sample domains
  tests/          # vitest suite
```

## Quickstart

```
npm install
npm run build

# Compile a domain (no files written)
forge compile examples/simple-blog/domain.ts

# Generate full-stack artifacts (backend + React frontend)
forge generate examples/simple-blog/domain.ts
# (add --skip-frontend if you only want backend output)
# (add --skip-auto-migrate if Docker/sandboxing isn't available)

# Run tests
npm test

# CLI help
forge --help

# Full smoke test (install Ã¢â€ â€™ build Ã¢â€ â€™ generate Ã¢â€ â€™ build frontend)
npm run smoke

# Run the generated frontend (after forge generate finishes)
cd examples/simple-blog/generated_frontend/frontend
npm install
npm run dev

# (optional) point the UI at a remote API instead of http://localhost:3000
# echo VITE_API_BASE_URL=http://my-api.example.com > .env.local
# npm run dev




# Launch the paste-and-generate UI
forge studio --port 4173
open http://localhost:4173
```

## Language Specification

- Full DSL reference: [docs/DSL_SPEC.md](docs/DSL_SPEC.md)
- Philosophy: [docs/PHILOSOPHY.md](docs/PHILOSOPHY.md)

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
  USING ((tenant_id = laforge_tenant_id()));
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

- `forge compile <domain-file>` Ã¢â‚¬â€œ validate and compile a domain definition.
- `forge generate <domain-file>` Ã¢â‚¬â€œ emit SQL, services, routes, and migrations under `<domain>/generated` (or `--out`).
- `forge diff <old-domain> <new-domain>` Ã¢â‚¬â€œ show schema-aware diffs between two domain definitions (`--json` available).
- `forge migrate` Ã¢â‚¬â€œ apply pending migrations under `.laforge/migrations` (supports `--dry-run`, `--check`, `--to`).
- `forge status` Ã¢â‚¬â€œ show applied vs. pending migrations.
- `forge test` Ã¢â‚¬â€œ run the Vitest suite.

All commands run locally in Node.jsÃ¢â‚¬â€no browser or DOM runtime required.

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
  repaired/            # auto-migrate fallbacks (only when sandbox can't rewrite)
```

`forge generate` compares the current domain to `schema.json`, writes the next migration into `.laforge/migrations/`, and (by default) runs the Docker-backed auto-migrate sandbox to validate/repair the SQL. Use `--skip-auto-migrate` if you need to bypass the sandbox (e.g., Docker unavailable); repaired fallbacks land in `.laforge/repaired/`. `forge migrate` applies pending migrations to the target database (SQLite by default, configurable with `--db`). `forge status` reports applied vs. pending.

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

- Ã¢Å“â€¦ Backend-only compiler and runtime
- Ã¢Å“â€¦ CLI for compile/generate/diff/test
- Ã¢Å“â€¦ Simple example domain
- Ã°Å¸Å¡Â§ Harden parser, validation, and schema diff/migration pipeline
- Ã°Å¸Å¡Â§ Add more real-world examples and migration strategies
- Ã°Å¸Å¡Â§ Publish ecosystem tooling (language server, VS Code snippets)

## Contributing

Issues and PRs are welcome. Please keep the repository backend-onlyÃ¢â‚¬â€no DOM, React, or playground dependencies.
