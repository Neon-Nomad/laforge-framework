---
id: multi-db-guide
title: Multi-DB Guide
sidebar_position: 3
---

Generation: `forge generate --db postgres|mysql|sqlite`  
Apply: `forge migrate --db postgres://...` or `--db mysql://...`; SQLite uses a file path (default `.laforge/dev.db`).

Type mapping highlights:
- Postgres: `uuid`, `text`, `jsonb`, `boolean`, `timestamp with time zone`.
- MySQL: `CHAR(36)` for uuid, `TINYINT(1)` for boolean, `JSON` for jsonb, `DATETIME` for datetime.
- SQLite: TEXT for most, INTEGER for integer/boolean, TEXT timestamps.

Limitations:
- SQLite FK/ALTER support is limited.
- MySQL CHECK constraints are not emitted.
