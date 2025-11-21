import React, { useEffect, useMemo, useState } from 'react';

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
        {trace.length ? trace.map((t, idx) => (
          <li key={idx}>{t.rule} → {t.result} ({t.detail || ''})</li>
        )) : <li>no trace</li>}
      </ul>
      <pre aria-label="raw-event">{JSON.stringify(entry, null, 2)}</pre>
    </div>
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

export function StudioHarness() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [type, setType] = useState<string>('decrypt');
  const [kmsHealth, setKmsHealth] = useState<any>(null);
  const [integrity, setIntegrity] = useState<any>(null);

  const loadAudit = async (t = type) => {
    const res = await fetch(`/api/audit?type=${encodeURIComponent(t)}&limit=50`);
    const data = await res.json();
    setEntries(data.entries || []);
  };

  useEffect(() => {
    void loadAudit(type);
  }, [type]);

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
    await loadAudit('decrypt');
  };

  return (
    <div>
      <AuditPanel entries={entries} onFilter={setType} onSelect={setSelected} />
      <ExplainDrawer entry={selected} />
      <KmsPanel onRotated={rotate} onHealth={setKmsHealth} />
      <IntegrityPanel kmsHealth={kmsHealth} integrity={integrity} refresh={async () => { await loadHealth(); await loadIntegrity(); }} />
    </div>
  );
}
