---
id: migration-workflow
title: Migration Workflow
sidebar_position: 2
---

1) Generate backend + migration  
`forge generate --db postgres`

- Compiles the domain
- Diffs against `.laforge/schema.json`
- Writes a migration to `.laforge/migrations/`
- Updates the schema snapshot

2) Apply migrations  
`forge migrate --db postgres://...`

- Executes pending migrations (Postgres / MySQL / SQLite)
- `--dry-run` shows SQL without applying
- `--check` fails CI if pending migrations exist

3) Check status  
`forge status`

- Shows applied vs pending migrations

Safe vs destructive:
- Default: `migrations.allowDestructive = false` (drops/type changes => warnings, skipped)
- `"migrations": { "allowDestructive": true }` to emit/apply destructive changes
