import React, { useCallback, useEffect, useState } from 'react';
import { CommandPalette } from './CommandPalette';

export interface AuditEntry {
  id: string;
  type: string;
  model?: string;
  tenantId?: string;
  userId?: string;
  timestamp: string;
  data?: {
    field?: string;
    guardPath?: string;
    residency?: { enforced?: string | null; violated?: boolean; source?: string | null };
    kms?: string;
    keyVersion?: string;
    abac?: { result?: string; reason?: string; expression?: string; trace?: { rule?: string; result?: string; detail?: string }[] };
  };
}

interface AuditPanelProps {
  entries: AuditEntry[];
  onFilter: (type: string) => void;
  onSelect: (entry: AuditEntry) => void;
}

function AuditPanel({ entries, onFilter, onSelect }: AuditPanelProps) {
  return (
    <section>
      <div>
        <button onClick={() => onFilter('decrypt')}>Decrypts</button>
        <button onClick={() => onFilter('pii_reveal_denied')}>PII Denials</button>
      </div>
      <table aria-label="audit-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Model</th>
            <th>Tenant</th>
            <th>User</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => (
            <tr key={entry.id} role="row" onClick={() => onSelect(entry)}>
              <td>{entry.type}</td>
              <td>{entry.model || ''}</td>
              <td>{entry.tenantId || ''}</td>
              <td>{entry.userId || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface DrawerProps {
  entry?: AuditEntry | null;
}

interface ApprovalEntry {
  id: string;
  branch?: string;
  approved?: boolean;
  approvals?: Array<{ decision: string; timestamp: string }>;
}

interface DriftStatus {
  enabled?: boolean;
  reason?: string;
  dbPath?: string;
  drift?: Array<{ table: string; missingColumns?: string[]; extraColumns?: string[] }>;
}

interface DeployGuardResults {
  ok: boolean;
  reason?: string;
  results?: {
    signed?: { ok: boolean };
    approved?: { ok: boolean };
    provenance?: { ok: boolean };
  };
}

function ExplainDrawer({ entry }: DrawerProps) {
  if (!entry) return null;
  const abac = entry.data?.abac || {};
  const residency = entry.data?.residency || {};
  const trace = abac.trace || [];
  return (
    <div role="dialog">
      <div data-testid="guard-path">Guard: {entry.data?.guardPath || '(unknown)'}</div>
      <div data-testid="residency">Residency: {residency.enforced || 'none'} / {residency.violated ? 'violated' : 'ok'}</div>
      <div data-testid="kms">KMS: {entry.data?.kms || 'unknown'} v{entry.data?.keyVersion || 'n/a'}</div>
      <div data-testid="abac-reason">ABAC: {abac.reason || 'n/a'}</div>
      <ul aria-label="abac-trace">
        {trace.length
          ? trace.map((t, idx) => (
              <li key={idx}>
                {t.rule}
                {' -> '}
                {t.result} ({t.detail || ''})
              </li>
            ))
          : <li>no trace</li>}
      </ul>
      <pre aria-label="raw-event">{JSON.stringify(entry, null, 2)}</pre>
    </div>
  );
}

function ApprovalsPanel({ approvals, onDecision }: { approvals: ApprovalEntry[]; onDecision: (id: string, decision: 'approved' | 'rejected') => Promise<void> }) {
  return (
    <section>
      <h3>Approvals</h3>
      <table aria-label="approvals-table">
        <thead>
          <tr>
            <th>Snapshot</th>
            <th>Branch</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {approvals.length === 0 ? (
            <tr>
              <td colSpan={4}>No snapshots pending.</td>
            </tr>
          ) : (
            approvals.map(item => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.branch || ''}</td>
                <td data-testid={`approval-status-${item.id}`}>{item.approved ? 'approved' : 'pending'}</td>
                <td>
                  <button onClick={() => onDecision(item.id, 'approved')}>Approve</button>
                  <button onClick={() => onDecision(item.id, 'rejected')}>Reject</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

function DriftPanel({ drift }: { drift?: DriftStatus | null }) {
  if (!drift) return <section aria-label="drift-panel">Loading drift…</section>;
  if (drift.enabled === false) {
    return <section aria-label="drift-panel">Drift unavailable ({drift.reason || 'disabled'})</section>;
  }
  const count =
    drift.drift?.filter(item => (item.missingColumns?.length || 0) + (item.extraColumns?.length || 0) > 0).length || 0;
  return (
    <section aria-label="drift-panel">
      <div>Drift tables: {count}</div>
      <div>DB: {drift.dbPath || ':memory:'}</div>
    </section>
  );
}

function DeployGuardPanel({ status, onVerify }: { status?: DeployGuardResults | null; onVerify: () => Promise<void> }) {
  return (
    <section aria-label="deploy-guard">
      <div aria-label="deploy-guard-status">{status ? (status.ok ? 'ready' : 'blocked') : 'loading'}</div>
      <div aria-label="deploy-guard-details">
        {status?.results ? (
          <>
            <span>signed: {status.results.signed?.ok ? 'ok' : 'pending'}</span>{' '}
            <span>approved: {status.results.approved?.ok ? 'ok' : 'pending'}</span>{' '}
            <span>provenance: {status.results.provenance?.ok ? 'ok' : 'pending'}</span>
          </>
        ) : (
          'no guard data'
        )}
      </div>
      <button onClick={onVerify}>Verify guard</button>
    </section>
  );
}

interface KmsPanelProps {
  onRotated: () => void;
  onHealth: (data: any) => void;
}

function KmsPanel({ onRotated, onHealth }: KmsPanelProps) {
  const [provider, setProvider] = useState('');
  const [version, setVersion] = useState('');
  const [tokens, setTokens] = useState('');
  const [status, setStatus] = useState('idle');

  const rotate = async () => {
    setStatus('running');
    const body = { provider: provider || undefined, version: version || undefined, tokens: tokens.split('\n').map(t => t.trim()).filter(Boolean) };
    const res = await fetch('/api/kms/rotate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await res.text());
    await onRotated();
    const health = await (await fetch('/api/kms/health')).json();
    onHealth(health);
    setStatus('done');
  };

  return (
    <section>
      <input aria-label="kms-provider" value={provider} onChange={e => setProvider(e.target.value)} placeholder="provider" />
      <input aria-label="kms-version" value={version} onChange={e => setVersion(e.target.value)} placeholder="version" />
      <textarea aria-label="kms-tokens" value={tokens} onChange={e => setTokens(e.target.value)} />
      <button onClick={rotate}>Rotate</button>
      <div aria-label="kms-rotate-status">{status}</div>
    </section>
  );
}

interface IntegrityPanelProps {
  kmsHealth?: any;
  integrity?: any;
  refresh: () => Promise<void>;
}

function IntegrityPanel({ kmsHealth, integrity, refresh }: IntegrityPanelProps) {
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <section>
      <div aria-label="kms-health">{kmsHealth ? `${kmsHealth.provider || 'unknown'} ${kmsHealth.version || ''}` : 'no health'}</div>
      <div aria-label="integrity-status">{integrity?.chain?.ok ? 'chain-ok' : 'chain-missing'}</div>
    </section>
  );
}

type GovernancePanel = 'audit' | 'integrity' | 'approvals' | 'drift' | 'deploy';

export interface StudioHarnessProps {
  panels?: GovernancePanel[];
}

const ALL_PANELS: GovernancePanel[] = ['audit', 'integrity', 'approvals', 'drift', 'deploy'];

export function StudioHarness({ panels }: StudioHarnessProps = {}) {
  const activePanels = new Set(panels && panels.length ? panels : ALL_PANELS);
  const includeAudit = activePanels.has('audit');
  const includeIntegrity = activePanels.has('integrity');
  const includeApprovals = activePanels.has('approvals');
  const includeDrift = activePanels.has('drift');
  const includeDeploy = activePanels.has('deploy');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [type, setType] = useState<string>('decrypt');
  const [kmsHealth, setKmsHealth] = useState<any>(null);
  const [integrity, setIntegrity] = useState<any>(null);
  const [approvals, setApprovals] = useState<ApprovalEntry[]>([]);
  const [drift, setDrift] = useState<DriftStatus | null>(null);
  const [deployGuard, setDeployGuard] = useState<DeployGuardResults | null>(null);

  const loadAudit = async (t = type) => {
    const res = await fetch(`/api/audit?type=${encodeURIComponent(t)}&limit=50`);
    const data = await res.json();
    setEntries(data.entries || []);
  };

  useEffect(() => {
    if (includeAudit) {
      void loadAudit(type);
    }
  }, [type, includeAudit]);

  const loadHealth = async () => {
    const res = await fetch('/api/kms/health');
    const data = await res.json();
    setKmsHealth(data);
  };

  const loadIntegrity = async () => {
    const res = await fetch('/api/integrity');
    const data = await res.json();
    setIntegrity(data);
  };

  const rotate = async () => {
    if (includeAudit) {
      await loadAudit('decrypt');
    }
  };

  const loadApprovals = async () => {
    const res = await fetch('/api/approvals?branch=main');
    const data = await res.json();
    setApprovals(data.items || []);
  };

  const submitDecision = async (id: string, decision: 'approved' | 'rejected') => {
    await fetch('/api/approvals/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision, reason: '' }),
    });
    await loadApprovals();
  };

  const loadDrift = async () => {
    const res = await fetch('/api/drift');
    const data = await res.json();
    setDrift(data);
  };

  const loadDeployGuard = async () => {
    const res = await fetch('/api/deploy/verify?branch=main');
    const data = await res.json();
    setDeployGuard(data);
  };

  useEffect(() => {
    if (includeApprovals) {
      void loadApprovals();
    }
  }, [includeApprovals]);

  useEffect(() => {
    if (includeDrift) {
      void loadDrift();
    }
  }, [includeDrift]);

  useEffect(() => {
    if (includeDeploy) {
      void loadDeployGuard();
    }
  }, [includeDeploy]);

  return (
    <div>
      {includeAudit && (
        <>
          <AuditPanel entries={entries} onFilter={setType} onSelect={setSelected} />
          <ExplainDrawer entry={selected} />
        </>
      )}
      {includeIntegrity && (
        <>
          <KmsPanel onRotated={rotate} onHealth={setKmsHealth} />
          <IntegrityPanel
            kmsHealth={kmsHealth}
            integrity={integrity}
            refresh={async () => {
              await loadHealth();
              await loadIntegrity();
            }}
          />
        </>
      )}
      {includeApprovals && <ApprovalsPanel approvals={approvals} onDecision={submitDecision} />}
      {includeDrift && <DriftPanel drift={drift} />}
      {includeDeploy && <DeployGuardPanel status={deployGuard} onVerify={loadDeployGuard} />}
    </div>
  );
}

type IncidentKind = 'audit' | 'drift' | 'policy';

interface IncidentEvent {
  id: string;
  kind: IncidentKind;
  timestamp: string;
  title: string;
  detail?: string;
  data?: unknown;
}

function useIncidentStream(): IncidentEvent[] {
  const [events, setEvents] = useState<IncidentEvent[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).EventSource) return;
    const source = new EventSource('/api/incidents/stream');
    const push = (event: IncidentEvent) => {
      setEvents(prev => [event, ...prev].slice(0, 40));
    };
    const pushAudit = (entry: AuditEntry) => {
      push({
        id: entry.id,
        kind: 'audit',
        timestamp: entry.timestamp,
        title: `${entry.type} ${entry.model ? `· ${entry.model}` : ''}`,
        detail: entry.userId ? `user ${entry.userId}` : undefined,
        data: entry,
      });
    };

    source.addEventListener('audit_snapshot', event => {
      try {
        const entries = JSON.parse((event as MessageEvent).data) as AuditEntry[];
        entries.slice().reverse().forEach(pushAudit);
      } catch {
        // ignore
      }
    });

    source.addEventListener('audit_event', event => {
      try {
        const entry = JSON.parse((event as MessageEvent).data) as AuditEntry;
        pushAudit(entry);
      } catch {
        // ignore
      }
    });

    source.addEventListener('drift_status', event => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          timestamp: string;
          snapshot: { enabled: boolean; reason?: string; drift?: Array<{ table: string; missingColumns: string[]; extraColumns: string[] }> };
        };
        const affected =
          payload.snapshot?.drift?.filter(d => (d.missingColumns || []).length || (d.extraColumns || []).length).length || 0;
        const detail = payload.snapshot?.enabled
          ? affected
            ? `${affected} table${affected === 1 ? '' : 's'} with drift`
            : 'No drift detected'
          : payload.snapshot?.reason || 'Drift disabled';
        push({
          id: `drift-${payload.timestamp}`,
          kind: 'drift',
          timestamp: payload.timestamp,
          title: 'Drift status updated',
          detail,
          data: payload.snapshot,
        });
      } catch {
        // ignore
      }
    });

    source.addEventListener('policy_event', event => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { entry: any; branch: string };
        push({
          id: `policy-${payload.entry?.id || Date.now()}`,
          kind: 'policy',
          timestamp: payload.entry?.createdAt || new Date().toISOString(),
          title: `Policy change on ${payload.branch}`,
          detail: payload.entry?.note || payload.entry?.hash,
          data: payload.entry,
        });
      } catch {
        // ignore
      }
    });

    source.addEventListener('incident_error', event => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { source: string; message: string };
        push({
          id: `error-${payload.source}-${Date.now()}`,
          kind: 'policy',
          timestamp: new Date().toISOString(),
          title: `Stream error (${payload.source})`,
          detail: payload.message,
        });
      } catch {
        // ignore
      }
    });

    return () => {
      source.close();
    };
  }, []);

  return events;
}

function IncidentFeed({ events }: { events: IncidentEvent[] }) {
  if (!events.length) {
    return (
      <div
        style={{
          border: '1px dashed rgba(255,255,255,0.2)',
          borderRadius: '12px',
          padding: '12px',
          marginBottom: '16px',
          color: '#9ca3af',
        }}
      >
        Waiting for live incidents…
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
      {events.slice(0, 8).map(evt => (
        <div
          key={evt.id}
          style={{
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '12px',
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: '#9ca3af', letterSpacing: '0.08em' }}>
            {evt.kind === 'audit' ? 'Audit' : evt.kind === 'drift' ? 'Drift' : 'Policy'}
          </div>
          <div style={{ fontWeight: 600 }}>{evt.title}</div>
          {evt.detail && <div style={{ color: '#cbd5f5', fontSize: '13px' }}>{evt.detail}</div>}
          <div style={{ color: '#6b7280', fontSize: '12px' }}>{new Date(evt.timestamp).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

interface RouteConfig {
  id: string;
  label: string;
  description: string;
  panels?: GovernancePanel[];
}

const ROUTES: RouteConfig[] = [
  {
    id: 'overview',
    label: 'Live Overview',
    description: 'Unified audit, integrity, and operator signals.',
  },
  {
    id: 'audit',
    label: 'Audit Stream',
    description: 'Decrypt and PII-deny events with explainability.',
    panels: ['audit'],
  },
  {
    id: 'integrity',
    label: 'Integrity & KMS',
    description: 'Chain verification, KMS health, and rotation controls.',
    panels: ['integrity'],
  },
  {
    id: 'approvals',
    label: 'Approvals Queue',
    description: 'Snapshot approvals and deploy checks.',
    panels: ['approvals'],
  },
  {
    id: 'operations',
    label: 'Operations Guard',
    description: 'Drift monitoring and deploy guard status.',
    panels: ['drift', 'deploy'],
  },
  {
    id: 'drift-live',
    label: 'Drift Monitor',
    description: 'Focused drift incident feed.',
    panels: ['drift'],
  },
];

interface RoleProfile {
  id: string;
  label: string;
  description: string;
  routes: string[];
}

const ROLE_PROFILES: RoleProfile[] = [
  {
    id: 'auditor',
    label: 'Auditor',
    description: 'Audit trail, integrity, and residency focus.',
    routes: ['audit', 'integrity', 'overview'],
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Approvals, integrity, and operations guard.',
    routes: ['integrity', 'approvals', 'operations', 'drift-live', 'overview'],
  },
  {
    id: 'platform',
    label: 'Platform',
    description: 'Drift, deploy guard, and approvals.',
    routes: ['operations', 'drift-live', 'approvals', 'overview'],
  },
  {
    id: 'developer',
    label: 'Developer',
    description: 'Audit stream and approvals for debugging.',
    routes: ['audit', 'approvals', 'overview'],
  },
];

function useHashRoute(defaultRoute: string): [string, (next: string) => void] {
  const readHash = () => {
    if (typeof window === 'undefined') return defaultRoute;
    const hash = window.location.hash.replace('#', '');
    return hash || defaultRoute;
  };
  const [route, setRoute] = useState<string>(readHash);
  useEffect(() => {
    const handler = () => {
      const next = readHash();
      setRoute(next);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const update = useCallback((next: string) => {
    if (typeof window !== 'undefined') {
      window.location.hash = next;
    }
    setRoute(next);
  }, []);

  return [route, update];
}

const PROFILE_STORAGE_KEY = 'laforge:governance:profile';

export function GovernanceApp() {
  const [route, setRoute] = useHashRoute('overview');
  const [profileId, setProfileId] = useState<string>(() => {
    if (typeof window === 'undefined') return ROLE_PROFILES[0].id;
    const stored = window.localStorage?.getItem(PROFILE_STORAGE_KEY);
    return stored && ROLE_PROFILES.some(role => role.id === stored) ? stored : ROLE_PROFILES[0].id;
  });
  const profile = ROLE_PROFILES.find(p => p.id === profileId) ?? ROLE_PROFILES[0];
  const allowedRoutes = new Set(profile.routes);
  const config = ROUTES.find(r => r.id === route) ?? ROUTES[0];
  useEffect(() => {
    if (!allowedRoutes.has(route)) {
      if (profile.routes.length) {
        setRoute(profile.routes[0]);
      }
    }
  }, [allowedRoutes, profile.routes, route, setRoute]);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem(PROFILE_STORAGE_KEY, profile.id);
    }
    if (profile.routes.length) {
      setRoute(profile.routes[0]);
    }
  }, [profile.id, profile.routes, setRoute]);
  const incidents = useIncidentStream();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const availableRoutes = ROUTES.filter(item => profile.routes.includes(item.id));

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        gap: '16px',
        minHeight: '400px',
        padding: '8px 0',
      }}
    >
      <aside
        style={{
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '14px',
          padding: '12px',
          background: 'rgba(255,255,255,0.03)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <label style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af' }}>
          Role Mode
          <select
            value={profileId}
            onChange={e => setProfileId(e.target.value)}
            style={{
              width: '100%',
              marginTop: '6px',
              borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.2)',
              padding: '6px 8px',
              background: 'rgba(255,255,255,0.05)',
              color: '#fff',
            }}
          >
            {ROLE_PROFILES.map(role => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </label>
        <div style={{ color: '#9ca3af', fontSize: '12px', minHeight: '42px' }}>{profile.description}</div>
        <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af' }}>Views</div>
        {availableRoutes.map(item => {
          const active = item.id === config.id;
          return (
            <button
              key={item.id}
              onClick={() => setRoute(item.id)}
              style={{
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '10px',
                padding: '10px 12px',
                background: active ? 'rgba(0,210,255,0.12)' : 'transparent',
                color: active ? '#00d2ff' : '#e5e7eb',
                textAlign: 'left',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {item.label}
            </button>
          );
        })}
      </aside>
      <section
        style={{
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '18px',
          padding: '16px',
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <div>
            <h2 style={{ margin: '0 0 4px' }}>{config.label}</h2>
            <p style={{ margin: '0 0 16px', color: '#9ca3af' }}>{config.description}</p>
          </div>
          <button
            onClick={() => setPaletteOpen(true)}
            style={{
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '10px',
              padding: '8px 12px',
              background: 'rgba(255,255,255,0.04)',
              color: '#e5e7eb',
              cursor: 'pointer',
            }}
            aria-label="Command Palette"
          >
            Command Palette (Ctrl+K)
          </button>
        </div>
        {config.id === 'overview' && <IncidentFeed events={incidents} />}
        <StudioHarness panels={config.panels} />
      </section>
      <CommandPalette
        profileId={profile.id}
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={setRoute}
      />
    </div>
  );
}
