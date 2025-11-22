# LaForge Governance Suite - Quick Start

## Running the Full Platform

LaForge has two components that must run together:
1. **Backend API** - Serves operator endpoints, SSE incident stream, drift detection
2. **Frontend Console** - React-based governance UI

### One-Command Launch

```bash
npm install
npm run studio
```

This starts both components in parallel with color-coded output:
- 🔵 **Backend** (cyan) - API server running on `http://localhost:3000`
- 🟣 **Frontend** (magenta) - Vite dev server on `http://localhost:5173`

**Then open:** [http://localhost:5173/governance](http://localhost:5173/governance)

---

## Individual Components (Manual)

If you need to run them separately:

### Terminal 1 - Backend
```bash
npm run dev
```

### Terminal 2 - Frontend
```bash
npm run dev:frontend
```

---

## What You'll See

### Governance Console Routes

- **/governance** - Full governance suite with role-based views
- **/studio** - Alternative entry point (same app)

### Available Views

1. **Live Overview** - Unified incident feed (audit, drift, policy changes)
2. **Audit Stream** - Decrypt/PII events with ABAC explainability
3. **Integrity & KMS** - Chain verification, KMS health, key rotation
4. **Approvals Queue** - Snapshot approvals with cryptographic signing
5. **Operations Guard** - Drift monitor + deploy guard status
6. **Drift Monitor** - Schema drift detection and alerting

### Role Profiles

Switch between operator modes:
- **Auditor** - Audit trails, compliance, residency
- **Security** - Approvals, integrity, KMS operations
- **Platform** - Drift monitoring, deploy guards
- **Developer** - Debugging with audit access

### Command Palette

Press **Ctrl+K** (or **Cmd+K**) to open the command palette:
- `g o` - Open Live Overview
- `g a` - Open Audit Stream
- `g i` - Open Integrity & KMS
- `g q` - Open Approvals Queue
- `d v` - Verify deploy guard
- `a enter` - Approve latest snapshot

---

## Backend API Endpoints

The backend serves these key routes:

### Operator APIs
- `GET /api/audit` - Audit event log
- `GET /api/integrity` - Provenance chain status
- `GET /api/approvals` - Snapshot approval queue
- `GET /api/drift` - Schema drift detection
- `GET /api/deploy/verify` - Deploy guard verification
- `GET /api/kms/health` - KMS provider health

### Real-Time Streaming
- `GET /api/incidents/stream` - Server-Sent Events (SSE) feed
  - Streams: audit events, drift status, policy changes
  - Polls: every 4s (audit), 15s (drift), 6s (policy)

### Studio UI
- `GET /governance` - Governance console HTML
- `GET /laforge-governance.js` - React bundle (compiled on-demand)

---

## Troubleshooting

### "Page is blank/broken"
- **Cause:** Backend not running
- **Fix:** Make sure `npm run dev` is running in Terminal 1

### "Cannot connect to SSE stream"
- **Cause:** Backend API not accessible
- **Fix:** Check `http://localhost:3000/health` responds

### "Port already in use"
- **Backend (3000):** Change `PORT` env var
- **Frontend (5173):** Vite will auto-increment to 5174

---

## Next Steps

1. **Generate a domain**
   ```bash
   npm run forge generate examples/simple-blog/domain.ts
   ```

2. **View audit logs** in the Governance Console

3. **Approve snapshots** via the Approvals Queue

4. **Monitor drift** in real-time

5. **Rotate KMS keys** from the Integrity panel

---

## Production Deployment

For production, see:
- [DEPLOYMENT_HARDENING.md](docs/DEPLOYMENT_HARDENING.md) - K8s/Helm setup
- [BACKUP_DR_PLAYBOOK.md](docs/BACKUP_DR_PLAYBOOK.md) - DR procedures
- [ENTERPRISE_READINESS.md](docs/ENTERPRISE_READINESS.md) - Full roadmap
