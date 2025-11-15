# LaForge Handbook

## Why LaForge Exists
- Policy-first: a single domain definition generates schema, RLS, services, routes, and migrations.
- Zero-drift: schema, policies, and domain services come from the same AST; drift is detected and blocked.
- Multi-tenant safety: tenant isolation is built in (schema + policies).
- Multi-DB: generate and apply migrations to Postgres, MySQL, or SQLite.

## Architecture Overview
```
domain.ts (DSL)
   |
   v
Parser/AST  ---> Validation
   |                 |
   |                 v
   |         Registry (models)
   v
Codegen --------------------------+
 |  |  |  |                       |
 |  |  |  +--> Zod schemas        |
 |  |  +----> Domain services     |
 |  +------> RLS policies (SQL)   |
 +---------> Routes               |
                                   |
         Diff engine + Adapters ---+
                     |
                     v
           Migrations (.laforge/)
```

## DSL Guide (essentials)
```forge
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
  ({ user, record }) => record.tenantId === user.tenantId || user.role === "admin"
}

hook Post.beforeCreate {
  record.slug = record.title.toLowerCase().replace(/\s+/g, '-')
}
```

## Migration Workflow
1) `forge generate --db postgres`  
   - Compiles the domain, diffs against `.laforge/schema.json`, writes a migration into `.laforge/migrations/`, updates schema snapshot.
2) `forge migrate --db postgres://...`  
   - Applies pending migrations; `--dry-run` shows pending; `--check` fails CI if pending.
3) `forge status`  
   - Shows applied vs pending (based on `.laforge/migrations/state.json`).

Safe vs destructive:
- Default: `migrations.allowDestructive = false` (drops/type changes become warnings and are skipped).
- Set `"migrations": { "allowDestructive": true }` to emit/destructively apply drops/type changes.

## Examples (ship in repo)
- `examples/simple-blog/` (multi-tenant blog with policies + hooks).
- Add your own under `examples/` and run `forge generate examples/your-domain.ts`.

## Plugin Guide (high level)
- Goal: let plugins hook compiler events and outputs.
- Recommended shape:
  - Types: define plugin interface with lifecycle hooks (pre-parse, post-parse, pre-codegen, post-codegen, pre-migration, adapter selection).
  - Config: expose plugin config via `forge.config.*`.
  - Outputs: allow plugins to append files/artifacts in codegen/migrations.
- Next steps (roadmap): publish a Plugin SDK with typed hooks and test harness.

## Multi-DB Guide
- Adapters: Postgres, MySQL, SQLite.
- Generation: `forge generate --db postgres|mysql|sqlite` (affects type mapping + DDL).
- Apply: `forge migrate --db postgres://...` or `--db mysql://...`; SQLite uses a file path (default `.laforge/dev.db`).
- Type mapping highlights:
  - Postgres: `uuid`, `text`, `jsonb`, `boolean`, `timestamp with time zone`.
  - MySQL: `CHAR(36)` for uuid, `TINYINT(1)` for boolean, `JSON` for jsonb, `DATETIME` for datetime.
  - SQLite: TEXT for most, INTEGER for integer/boolean, TEXT timestamps.
- Limitations: SQLite FK/ALTER support is limited; MySQL CHECK constraints are not emitted.

## CLI Commands (quick reference)
- `forge compile <domain>` – validate/compile only.
- `forge generate <domain> [--db postgres|mysql|sqlite] [--allow-destructive]` – emit artifacts + incremental migration + snapshot.
- `forge diff <old> <new> [--json]` – schema-aware diff with colors/JSON.
- `forge migrate [--db <url|file>] [--dry-run] [--check] [--to <file>]` – apply pending migrations.
- `forge status` – show applied/pending migration state.
- `forge test` – run Vitest suite.

## Runtime API (brief)
- `LaForgeRuntime` (SQLite in-memory by default):
  - `compile(dsl: string)` -> CompilationOutput
  - `execute(model, op, user, data)` -> CRUD via generated domain services
  - Sandbox enforces allowed modules (`zod`, `./sql`).
- DB adapters:
  - SQLite: `runtime/db/database.ts`
  - Postgres: `runtime/db/postgres.ts`
  - MySQL: `runtime/db/mysql.ts`

## Contribution Guidelines
- Keep backend-only (no DOM/React).
- Add tests for new features (Vitest).
- Respect safe vs destructive migration defaults.
- For adapters: ensure DDL matches target, and apply path handles connection URLs.
- For plugins: keep APIs stable and typed; add harness tests.

## Diagrams (text)
Pipeline:
```
[DSL] -> [Parser/AST] -> [Registry/Validation] -> [Codegen: Zod/Domain/RLS/Routes]
                                   |
                      [Diff Engine + SQL Adapters]
                                   |
                         [Migrations + Snapshot]
                                   |
                             [forge migrate]
```

State:
```
.laforge/
  schema.json        # last compiled snapshot
  migrations/
    20250201_x.sql   # incremental migrations
    state.json       # applied log

## CTO Executive Summary

- LaForge is a policy-first backend compiler that generates an entire backend (schema, RLS, services, routes, validation, migrations) from one domain definition.
- It replaces the ORM layer entirely; LaForge outputs real backend code and wiring, not a runtime abstraction.
- Zero-drift safety: schema, policies, and services are AST-aligned; unsafe states are blocked.
- Multi-DB execution: Postgres, MySQL, and SQLite generation and migration application.

**One-sentence value prop:** LaForge turns backend development into a compiler problem — not a hand-written code problem.

## LaForge Replaces ORMs

Traditional tools (Prisma, Drizzle, Kysely, Supabase) help you write backend code. LaForge eliminates backend code by compiling the domain into the entire backend stack.

Correct mental model:
- ORM layer: “Map models and write queries.”
- LaForge layer: “Define your domain; the compiler emits the whole backend.”

### Capability Comparison

| Capability | LaForge | Prisma | Drizzle | Kysely | Supabase | ORMs (General) |
| --- | --- | --- | --- | --- | --- | --- |
| Policy-first model | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Generates backend services | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Generates routes/handlers | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Generates validation (Zod) | ✔ | Partial | Partial | ✖ | ✖ | ✖ |
| Generates RLS policies | ✔ | ✖ | ✖ | ✖ | Partial | ✖ |
| Generates migrations | ✔ | ✔ | ✔ | Partial | Partial | Partial |
| Rename/type/null/default diff | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Zero-drift guarantees | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Multi-DB (PG/MySQL/SQLite) | ✔ | ✔ | ✔ | ✔ | ✖ | Varies |
| Migration execution | ✔ | ✔ | ✔ | Partial | ✖ | Varies |
| Compiler-based | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Plugin system | ✔ (roadmap) | Partial | Partial | ✖ | ✖ | ✖ |
| Multi-tenant schema + policy | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ |
| CI-friendly JSON diffs | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Generated types/models | ✔ | ✔ | ✔ | ✔ | Partial | Varies |

## Roadmap & Future Direction

**Short term (v1.1–v1.3)**
- Plugin SDK: typed hooks for AST transforms, codegen augmentation, custom adapters/RLS.
- Example apps: Simple API, Blog, Payments (runnable end-to-end).
- Docs site: Docusaurus/Astro-based handbook and guides.

**Medium term**
- Additional adapters: MSSQL, Oracle (optional), DuckDB.
- Static analysis: policy/tenant leak detection, dead model/policy warnings.
- Generated admin scaffolding (optional).

**Long term vision**
- Deterministic backend pipelines: rebuild from DSL across environments.
- Cloud-managed migrations: hosted multi-env schema workflows.
- AI-assisted DSL authoring: natural language → domain/policies/routes.

**Strategic positioning:** LaForge aims to be the Terraform of backend code — declarative backend infrastructure compiled from one specification.

## Badges (GitHub-ready)

Place near the top of the README (update URLs to your repo):
- ![Build](https://img.shields.io/github/actions/workflow/status/Neon-Nomad/laforge-framework/ci.yml?label=build)
- ![Tests](https://img.shields.io/github/actions/workflow/status/Neon-Nomad/laforge-framework/tests.yml?label=tests)
- ![License](https://img.shields.io/github/license/Neon-Nomad/laforge-framework)
- ![Version](https://img.shields.io/npm/v/laforge)
- ![Coverage](https://img.shields.io/codecov/c/github/Neon-Nomad/laforge-framework)

## ASCII Diagrams (executive-friendly)

Pipeline:
```
      ┌────────┐
      │  DSL   │  domain.ts
      └────┬───┘
           │
           ▼
     ┌────────────┐
     │ Parser/AST │
     └────┬───────┘
          │
          ▼
  ┌───────────────┐
  │ Validation +   │
  │ Model Registry │
  └─────┬─────────┘
        │
        ▼
┌──────────────────────────────┐
│      CODE GENERATION         │
│  Zod | Services | RLS | API  │
└──────────┬───────────────────┘
           │
           ▼
     ┌────────────┐
     │ Diff Engine│
     └────┬───────┘
          │
          ▼
   ┌────────────────┐
   │ SQL Adapters   │
   │ PG/MySQL/SQLite│
   └─────┬──────────┘
         │
         ▼
  ┌──────────────────────┐
  │ Migrations + Snapshot│
  └──────────────────────┘
```

Adapter selection:
```
forge migrate --db <connection>

if postgres:// -> PostgresConnection
if mysql://    -> MySQLConnection
else           -> SQLiteConnection
```

Multi-tenant flow:
```
user -> context -> RLS/Policies -> service -> db adapter
```
```
