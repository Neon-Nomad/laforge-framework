# Backup & DR Playbook

This playbook defines the minimum controls for LaForge backups, PITR, and restores.

## Targets
- Postgres databases (primary)
- Signatures/keys (`.laforge/keys/*`)
- Provenance and SBOM artifacts (`.laforge/provenance/*`, `.laforge/sbom/*`)

## Backups

### Postgres logical backups
- Use the provided CronJob: `deploy/k8s/backup.yaml` (daily at 03:00 UTC).
- Artifacts land in a PVC (`laforge-backup-pvc`); sync that PVC to object storage (S3/Azure/GCS) via your backup operator or a sidecar.
- Format: `pg_dump --format=custom` compressed; includes schema+data.

### PITR
- Enable WAL archiving on the database service (cloud-managed or self-managed).
- Store WAL in a dedicated bucket with lifecycle retention that matches your RPO/RTO.
- Verify WAL + base backup can be restored weekly (see Restore drills).

### Keys and provenance
- Store signing keys and provenance/SBOM artifacts in your secret manager (not in the image).
- For K8s: mount keys from Secrets; rotate keys with labeled versions; keep public keys in-source for verification.

## Restore drills
- Weekly: restore latest logical backup to a non-prod environment; run `laforge verify chain` and a short smoke test (`npm run smoke` or `scripts/smoke-fullstack`).
- Quarterly: perform PITR to a timestamp; re-run Studio/CLI integrity checks (chain + provenance + approvals).

## DR runbook (sample)
1) Declare incident; freeze deploys.
2) Provision fresh DB; restore latest verified backup; apply WAL to target point (if PITR).
3) Restore `.laforge/keys` (public keys), provenance, and SBOMs to the runtime.
4) Run `laforge verify chain --branch <main>` and `laforge verify provenance`.
5) Bring up runtime/studio using blue/green labels; warmup health checks.
6) Gradually shift traffic (use `laforge deploy --strategy bluegreen` guard); watch rejection/error budgets.

## Verification steps you should automate
- After each backup: run `pg_restore --list` to sanity-check archives.
- Daily: `laforge verify chain && laforge verify provenance` against the current deployment snapshot.
- During rollout: block if chain/signature/provenance/approval requirements are not met.

## Storage and retention guidelines
- Keep at least 7–14 days of daily logical backups; longer retention per compliance.
- Keep WAL for PITR aligned to recovery goals (e.g., 7 days).
- Encrypt at rest (provider-managed KMS) and in transit (TLS).

## Access control
- Only backup/restore service accounts can read DB credentials, keys, and backup buckets.
- All restore actions should emit audit entries (tie into the existing audit sink).

## Monitoring
- Alert on failed CronJobs and backup PVC usage.
- Alert on WAL archive lag or replication lag (if replicas in use).
- Expose backup success metric to Prometheus; surface in Grafana “Operations” dashboard.
