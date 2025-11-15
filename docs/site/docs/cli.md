---
id: cli
title: CLI Reference
sidebar_position: 4
---

- `forge compile <domain>` – validate/compile only.
- `forge generate <domain> [--db postgres|mysql|sqlite] [--allow-destructive]` – emit artifacts + incremental migration + snapshot.
- `forge diff <old> <new> [--json]` – schema-aware diff with colors/JSON.
- `forge migrate [--db <url|file>] [--dry-run] [--check] [--to <file>]` – apply pending migrations.
- `forge status` – show applied/pending migration state.
- `forge test` – run Vitest suite.
