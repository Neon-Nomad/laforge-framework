# Enterprise Readiness Roadmap

Status: baseline compiler/Studio are stable for teams; this document lists the gaps and the implementation plan to make LaForge Fortune 500 ready.

## 1) Identity & Access (SSO/SCIM/RBAC)
- Add OIDC/SAML auth for Studio and generated services.
- Map IdP groups to DSL-defined roles; expose RBAC/ABAC in the DSL (roles, claims, org scopes).
- SCIM inbound provisioning hooks to sync users/groups into the domain context.
- Session hardening: short-lived tokens, refresh flow, tenant scoping.
- Execution plan: see docs/IDENTITY_ACCESS_PLAN.md.

## 2) Audit, Approvals, and Signing
- [done] Append-only audit log for schema changes, migrations, timeline actions, RBAC events, and policy edits (DB table + NDJSON sink, immutability triggers); surfaced in Studio Audit Trail and CLI.
- [done] Cryptographically signed snapshots with hash+prevHash+Ed25519 signature/publicKey; chain verification in CLI (`laforge verify chain`) and Studio Integrity panel; provenance export.
- [done] Approval workflow v1 via CLI (approve/reject/annotate) with optional signed approvals; deployment guard can require signed+approved snapshot.

### What we will build
- **Audit log** (shipped): domain+Studio events (migrations applied/repaired, policies edited, DSL changes, approvals, snapshot restore) persisted append-only; emits to Postgres table or file sink; includes actor (user/role/claims), tenant, request id, timestamp, hash of artifact; visible via Studio Audit Trail and `laforge audit` commands.
- **Signing** (shipped): SHA-256 hash + Ed25519 signatures for snapshots; chain verification in CLI/Studio; provenance export.
- **Approvals** (shipped v1): CLI approvals/annotations bound to snapshots with audit entries and optional signatures; deploy guard flag for signed+approved state. Studio approvals UI and policy-diff-driven “approval required” markers are next.

### Phased plan
1) **Audit plumbing** [done]
   - Audit writer in runtime/CLI/Studio; append-only table + file sink with immutability triggers; PII-minimized payloads.
   - Tests: audit events for migrations, policy edits, branch ops; append-only enforced.
2) **Snapshot signing** [done]
   - Hash + signature stored on snapshots; chain verification in CLI/Studio; provenance export.
   - Next: extend to migration SQL and policy/RLS bundles; expose key ids/rotation.
3) **Approvals workflow** [in flight] (CLI v1 + Studio Integrity panel)
   - CLI approve/reject/annotate with audit trail and optional signatures; deploy guard flag for signed+approved/provenance-required state; Studio approvals UI shows queue, decisions, and drift/migration status.
   - Next: configurable quorum, policy-diff-driven “approval required” markers, and auto-block on unapproved diffs.
4) **Runtime hooks + hardening** [next]
   - Production mode rejection of unsigned/unauthorized artifacts; optional Merkle-chain for audit entries; periodic checksum verification job; webhook sink for SIEM/SOAR.

### Deliverables per milestone
- Code + tests + docs (CLI flags, Studio screenshots, API contract for audit sink).
- Migration to create audit tables and approval queue tables.
- Default-off flags for signing enforcement and approval gating; enable in staged rollouts.

## 3) Observability & Ops
- [done] Prometheus `/metrics` for runtime + Studio with HTTP rate/latency, model ops, RBAC/ABAC rejects, compile and migration durations; health (`/health`) and readiness (`/ready`) probes shipped.
- [done] Optional OTEL spans around CLI compile/generate/migrate, runtime compile/execute, and generated services (create/read/update/delete) via `traceSpan` hook.
- [done] Sample Grafana dashboard: `docs/grafana-dashboard-laforge.json` (HTTP rate/latency, migration duration, reject rate, compile/generate duration, model ops success/failure).
- Next: OTEL exporter config/snippets, log shipping guidance, and p95 budget tests for migrations.

## 4) Deployment Hardening
- [started] HA artifacts: starter Helm chart + K8s manifests (runtime, Studio, ingress) with blue/green labels and probes.
- [started] Blue/green and canary migrations; staged rollouts with automatic pause on errors via `laforge deploy --strategy bluegreen`.
- [added] Backup/DR playbook + K8s backup CronJob; PITR guidance and restore drills.

## 5) Data Protection & Compliance
- DSL annotations for PII/PHI; field-level encryption/tokenization options.
- Data residency flags; schema partitioning per region/tenant.
- Secrets management integration (AWS/GCP/Azure/KMS) for generated services and Studio.
- Privacy/compliance audit hooks (SOC2/ISO playbook alignment).
  - [started] DSL `pii`/`secret`/`residency(<region>)` captured; runtime redaction auto-uses compiled PII/secret fields; residency enforcement blocks create/update on mismatched runtime residency; secret fields encrypted with `LAFORGE_SECRET_KEY`.
- [new] KMS plug-in layer with enc2 envelope tokens (provider + version metadata) supporting AWS/Azure/GCP/Vault/local; `/api/kms/health` + Studio Integrity card show provider/version/health; rotation via `laforge kms rotate` or Studio “KMS rotation” rewraps data keys without decrypting data; audit filters include `decrypt` and `pii_reveal_denied` for compliance review.

## 6) Supply Chain Security
- SBOMs (CycloneDX/SPDX) for CLI/runtime and generated artifacts; attach to every release + provenance export. (`npm run sbom`, `laforge sign sbom`, `laforge verify sbom --require-signature`)
- Signed artifacts: npm package signing + existing snapshot signatures; optional cosign/sigstore for containers/zips. (`npm run ci:supplychain:strict` enforces SBOM + signature in CI)
- Repro builds: locked deps, deterministic zip/tar outputs for generated code; reproducible generate/build scripts.
- CI gate: dependency scanning (npm audit/GHAS/Snyk) and signature/SBOM verification before publish/deploy.

### Phased plan
1) **Visibility** (SBOM + lock discipline)
   - Add `npm run sbom` to emit CycloneDX for root/workspaces and generated output; store in `.laforge/sbom/`.
   - Enforce lockfile checks and hash/prevHash in generated bundles; attach SBOM to provenance export; `laforge verify sbom` used in pipelines.
2) **Signing and provenance**
   - Sign npm packages and container images (cosign/sigstore); embed snapshot hash/version in build info.
   - Extend `laforge verify` to accept SBOM + signature inputs; CI template that blocks on invalid signatures (`npm run ci:supplychain:strict`).
3) **Reproducibility**
   - Deterministic generate/build: pin node version, normalize timestamps in archives, stable hashing of compiled.json/migrations.
   - Add `npm run repro` script that rebuilds generated assets and diffs against expected hashes.
4) **Scanning/Gating**
   - Default CI steps: npm audit (fail on high), SAST for generated code, license policy checks.
   - Optional “trusted deps only” mode: allowlist hash set for high-risk deps.

### Deliverables
- CLI scripts: `npm run sbom`, `laforge verify chain` reused for provenance; sample GitHub Actions workflow for SBOM+signing gates.
- Documentation: how to publish signed packages, verify signatures, and consume SBOMs.
- Sample Grafana/Prometheus dashboard stays in `docs/grafana-dashboard-laforge.json` for ops reporting.
- CI hooks: `npm run ci:supplychain` (SBOM + repro + sbom verification); `npm run verify:sbom` checks lockfile hash drift.
- Optional signing: `npm run sign:sbom` / `npm run verify:sbom:sig` when `.laforge/keys/ed25519_private.pem` is present; wire into release CI when keys are available.

## 7) Runtime Controls
- [done] Rate limiting and WAF hook points for generated routes (token bucket + regex shield; 429/403 responses) with metrics surfaced to Studio.
- [done] API auth story for generated services (JWT/OIDC) consistent with DSL policies; tenant header guard; expired token rejection.
- [done] Safe defaults for CORS/headers; dependency vulnerability scanning in CI (`npm run ci:security`); optional PII redaction middleware.

## 8) Operator UX
- [done] Admin console surfaces approvals queue, drift alerts, migration status, audit feed; Integrity panel shows signed/approved/provenance status with “verify now” actions.
- [done] Roll-forward/rollback commands with safety checks (`laforge rollback` + Studio apply/rollback actions) and deployment guard toggles for signed/approved/provenance-required.
- [done] Policy/RLS diff previews with impact analysis before apply (policy-impact API + diff snippets in Studio).
- Next: configurable approval quorum, SLO widgets fed by Prometheus counters, and richer drift auto-heal actions.

## Execution Approach
1. Ship identity + signing + audit logging first (foundation for approvals).
2. Add observability hooks and health probes.
3. Deliver deployment artifacts (Helm/manifests), backup/DR playbooks, and canary/blue/green flow.
4. Layer PII tagging/encryption/residency into DSL + generated code.
5. Supply-chain hardening (SBOM, signed releases).
6. Operator UX: approvals UI, impact analysis, rollback tools.

Each milestone will land with tests, docs, and toggles for phased rollout. This file tracks scope; corresponding implementation PRs will close items as they land.
