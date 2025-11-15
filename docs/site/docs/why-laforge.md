---
id: why-laforge
title: Why LaForge
sidebar_position: 2
---

LaForge is a policy-first backend compiler. It does not compete with ORMs or code-first tools — it replaces them.

**One-sentence value prop:** LaForge turns backend development into a compiler problem — not a hand-written code problem.

Principles:
- Policy-first: policies compile into schema, RLS, routes, and service logic.
- Zero drift: schema, policies, and services come from one AST; drift is blocked.
- Multi-tenant safety: enforced at schema + policy + runtime layers.
- Multi-database: generate/apply migrations across Postgres, MySQL, and SQLite.
- Compiler, not ORM: LaForge outputs backend code targeting real databases.
