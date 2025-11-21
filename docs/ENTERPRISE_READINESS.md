# Enterprise Readiness Roadmap

Status: baseline compiler/Studio are stable for teams; this document lists the gaps and the implementation plan to make LaForge Fortune 500 ready.

## 1) Identity & Access (SSO/SCIM/RBAC)
- Add OIDC/SAML auth for Studio and generated services.
- Map IdP groups to DSL-defined roles; expose RBAC/ABAC in the DSL (roles, claims, org scopes).
- SCIM inbound provisioning hooks to sync users/groups into the domain context.
- Session hardening: short-lived tokens, refresh flow, tenant scoping.
- Execution plan: see docs/IDENTITY_ACCESS_PLAN.md.

## 2) Audit, Approvals, and Signing
- ✅ Append-only audit log for schema changes, migrations, timeline actions, RBAC events, and policy edits (DB table + NDJSON sink, immutability triggers); surfaced in Studio Audit Trail and CLI.
- ✅ Cryptographically signed snapshots with hash+prevHash+Ed25519 signature/publicKey; chain verification in CLI (`laforge verify chain`) and Studio Integrity panel; provenance export.
- ✅ Approval workflow v1 via CLI (approve/reject/annotate) with optional signed approvals; deployment guard can require signed+approved snapshot.

### What we will build
- **Audit log** (shipped): domain+Studio events (migrations applied/repaired, policies edited, DSL changes, approvals, snapshot restore) persisted append-only; emits to Postgres table or file sink; includes actor (user/role/claims), tenant, request id, timestamp, hash of artifact; visible via Studio Audit Trail and `laforge audit` commands.
- **Signing** (shipped): SHA-256 hash + Ed25519 signatures for snapshots; chain verification in CLI/Studio; provenance export.
- **Approvals** (shipped v1): CLI approvals/annotations bound to snapshots with audit entries and optional signatures; deploy guard flag for signed+approved state. Studio approvals UI and policy-diff-driven “approval required” markers are next.

### Phased plan
1) **Audit plumbing** ✅
   - Audit writer in runtime/CLI/Studio; append-only table + file sink with immutability triggers; PII-minimized payloads.
   - Tests: audit events for migrations, policy edits, branch ops; append-only enforced.
2) **Snapshot signing** ✅
   - Hash + signature stored on snapshots; chain verification in CLI/Studio; provenance export.
   - Next: extend to migration SQL and policy/RLS bundles; expose key ids/rotation.
3) **Approvals workflow** ✅ (CLI v1)
   - CLI approve/reject/annotate with audit trail and optional signatures; deploy guard flag for signed+approved state.
   - Next: Studio approvals UI, configurable quorum, and policy-diff-driven “approval required” markers.
4) **Runtime hooks + hardening** ▶
   - Production mode rejection of unsigned/unauthorized artifacts; optional Merkle-chain for audit entries; periodic checksum verification job; webhook sink for SIEM.

### Deliverables per milestone
- Code + tests + docs (CLI flags, Studio screenshots, API contract for audit sink).
- Migration to create audit tables and approval queue tables.
- Default-off flags for signing enforcement and approval gating; enable in staged rollouts.

## 3) Observability & Ops
- ✅ Prometheus `/metrics` for runtime + Studio with HTTP rate/latency, model ops, RBAC/ABAC rejects, compile and migration durations; health (`/health`) and readiness (`/ready`) probes shipped.
- ✅ Optional OTEL spans around CLI compile/generate/migrate, runtime compile/execute, and generated services (create/read/update/delete) via `traceSpan` hook.
- ✅ Sample Grafana dashboard: `docs/grafana-dashboard-laforge.json` (HTTP rate/latency, migration duration, reject rate, compile/generate duration, model ops success/failure).
- Next: OTEL exporter config/snippets, log shipping guidance, and p95 budget tests for migrations.

## 4) Deployment Hardening
- HA guidance and artifacts: container images, Helm charts, K8s manifests.
- Backup/restore playbooks; PITR guidance; DR runbooks.
- Blue/green and canary migrations; staged rollouts with automatic pause on errors.

## 5) Data Protection & Compliance
- DSL annotations for PII/PHI; field-level encryption/tokenization options.
- Data residency flags; schema partitioning per region/tenant.
- Secrets management integration (AWS/GCP/Azure/KMS) for generated services and Studio.
- Privacy/compliance audit hooks (SOC2/ISO playbook alignment).

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
- ✔ Rate limiting and WAF hook points for generated routes (token bucket + regex shield; 429/403 responses) with metrics surfaced to Studio.
- ✔ API auth story for generated services (JWT/OIDC) consistent with DSL policies; tenant header guard; expired token rejection.
- ✔ Safe defaults for CORS/headers; dependency vulnerability scanning in CI (`npm run ci:security`); optional PII redaction middleware.

## 8) Operator UX
- Admin console surfaces: approvals queue, drift alerts, migration status, audit feed.
- Roll-forward/rollback commands with safety checks. (`laforge rollback`, new Studio metrics endpoint for Security Health)
- Policy/RLS diff previews with impact analysis before apply.

## Execution Approach
1. Ship identity + signing + audit logging first (foundation for approvals).
2. Add observability hooks and health probes.
3. Deliver deployment artifacts (Helm/manifests), backup/DR playbooks, and canary/blue/green flow.
4. Layer PII tagging/encryption/residency into DSL + generated code.
5. Supply-chain hardening (SBOM, signed releases).
6. Operator UX: approvals UI, impact analysis, rollback tools.

Each milestone will land with tests, docs, and toggles for phased rollout. This file tracks scope; corresponding implementation PRs will close items as they land.
