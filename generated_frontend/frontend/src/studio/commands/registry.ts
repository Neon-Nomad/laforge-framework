export type OperatorCommand = {
  id: string;
  label: string;
  profileAllowlist: string[];
  route?: string;
  run?: () => Promise<void>;
  category: 'nav' | 'audit' | 'approvals' | 'drift' | 'deploy' | 'kms' | 'integrity';
  hotkey?: string;
  description?: string;
};

const PROFILE_IDS = ['auditor', 'security', 'platform', 'developer'];

function ensureOk(res: Response) {
  if (!res.ok) {
    throw new Error(`Command failed (${res.status})`);
  }
}

const COMMANDS: OperatorCommand[] = [
  {
    id: 'nav:overview',
    label: 'Open Live Overview',
    profileAllowlist: PROFILE_IDS,
    route: 'overview',
    category: 'nav',
    hotkey: 'g o',
    description: 'Shows the unified incident feed.',
  },
  {
    id: 'nav:audit',
    label: 'Open Audit Stream',
    profileAllowlist: PROFILE_IDS,
    route: 'audit',
    category: 'nav',
    hotkey: 'g a',
    description: 'Focus the audit explainability panel.',
  },
  {
    id: 'nav:integrity',
    label: 'Open Integrity & KMS',
    profileAllowlist: ['auditor', 'security'],
    route: 'integrity',
    category: 'nav',
    hotkey: 'g i',
    description: 'Review KMS state and provenance chain.',
  },
  {
    id: 'nav:approvals',
    label: 'Open Approvals Queue',
    profileAllowlist: ['security', 'platform', 'developer'],
    route: 'approvals',
    category: 'nav',
    hotkey: 'g q',
    description: 'Snapshot approval workflow.',
  },
  {
    id: 'nav:operations',
    label: 'Open Operations Guard',
    profileAllowlist: ['security', 'platform'],
    route: 'operations',
    category: 'nav',
    description: 'Deploy guard and drift monitors.',
  },
  {
    id: 'nav:drift',
    label: 'Open Drift Monitor',
    profileAllowlist: ['security', 'platform'],
    route: 'drift-live',
    category: 'nav',
    description: 'Targeted drift insight view.',
  },
  {
    id: 'deploy:verify',
    label: 'Verify deploy guard',
    profileAllowlist: ['security', 'platform'],
    category: 'deploy',
    hotkey: 'd v',
    run: async () => {
      const res = await fetch('/api/deploy/verify?branch=main');
      ensureOk(res);
    },
  },
  {
    id: 'integrity:recompute',
    label: 'Recompute provenance',
    profileAllowlist: ['auditor', 'security'],
    category: 'integrity',
    run: async () => {
      const res = await fetch('/api/integrity/recompute', { method: 'POST' });
      ensureOk(res);
    },
  },
  {
    id: 'kms:rotate',
    label: 'Rotate KMS key',
    profileAllowlist: ['security'],
    category: 'kms',
    run: async () => {
      const res = await fetch('/api/kms/rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens: [] }),
      });
      ensureOk(res);
    },
  },
  {
    id: 'approvals:approve',
    label: 'Approve latest snapshot',
    profileAllowlist: ['security', 'platform'],
    category: 'approvals',
    hotkey: 'a enter',
    run: async () => {
      const res = await fetch('/api/approvals/approveLatest', { method: 'POST' });
      ensureOk(res);
    },
  },
];

export function getCommandsForProfile(profileId: string): OperatorCommand[] {
  return COMMANDS.filter(cmd => cmd.profileAllowlist.includes(profileId));
}
