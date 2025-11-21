# Deployment Hardening Playbook

This playbook codifies the blue/green rollout logic, guardrails, and the on-disk artifacts you need to run LaForge safely in production.

## Blue/Green with Automatic Pause

LaForge ships a rollout guard that plans and simulates blue/green cutovers with built-in pause triggers:

- Migration failure on the candidate slot.
- Health probes exceeding latency budget.
- Error rate exceeding the configured budget during shift/monitoring.

### CLI plan

```bash
laforge-dev-cli deploy --strategy bluegreen \
  --traffic-steps 20,80,100 \
  --latency-budget 450 \
  --error-budget 0.02
```

Output: JSON plan with phases, traffic steps, pause conditions, and rollback actions.

### Runtime state machine

The rollout guard advances through:

1) migrate candidate → 2) warmup health checks → 3) progressive traffic shift → 4) monitoring.

Auto-pause freezes the shift and recommends rollback when:

- Migrations fail.
- Health check fails or latency budget is exceeded.
- Error budget is breached while monitoring.

Resume and rollback events are supported to continue or unwind.

## K8s/Helm artifacts (starter)

- `deploy/k8s/runtime.yaml` – runtime Deployment + Service with readiness/liveness, PodDisruptionBudget, and minimal NetworkPolicy.
- `deploy/k8s/studio.yaml` – Studio Deployment + Service.
- `deploy/k8s/ingress.yaml` – sample ingress with TLS + HSTS headers.
- `deploy/helm/values.yaml` – knobs for blue/green labels (`app.kubernetes.io/version`), replica counts, resources, probes, and rollout strategy.

These manifests are intentionally conservative: limited pod concurrency, strict probes, and labels for color-based routing. Integrate them into your existing GitOps/Helm flow and wire the blue/green labels into your load balancer or service mesh routes.

## Backups / DR

- Run database backups on a schedule (cronjob + cloud-native snapshots) and test restores weekly.
- Enable PITR on your database tier when available; store WAL/LSN streams in a separate bucket.
- Keep DSNs, signing keys, and SBOMs in your secrets manager; never bake them into images.

## Canary / staged rollouts

- Start with a small percentage (5–10%) before blue/green 50/50 and 100% cutover.
- Reuse the error-budget pause conditions from the blue/green guard to auto-freeze canaries.
- Always run migrations in “shadow” mode first (candidate only) before shifting live traffic.

## Hooks for GitOps

- Wire `laforge deploy --require-signed --require-approved --require-provenance` into your CD pipeline pre-flight.
- Block rollout if provenance or approvals fail; emit audit entries for allow/deny decisions.
- Keep the generated `docs/grafana-dashboard-laforge.json` deployed alongside Prometheus to watch migration timings and reject rates during rollout.
