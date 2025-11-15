---
id: runtime-api
title: Runtime API
sidebar_position: 5
---

- `LaForgeRuntime` (SQLite in-memory by default):
  - `compile(dsl: string)` -> CompilationOutput
  - `execute(model, op, user, data)` -> CRUD via generated domain services
  - Sandbox enforces allowed modules (`zod`, `./sql`).
- DB adapters:
  - SQLite: `runtime/db/database.ts`
  - Postgres: `runtime/db/postgres.ts`
  - MySQL: `runtime/db/mysql.ts`
