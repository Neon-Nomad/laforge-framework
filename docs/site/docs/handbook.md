---
id: handbook
title: LaForge Handbook
sidebar_position: 1
---

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
