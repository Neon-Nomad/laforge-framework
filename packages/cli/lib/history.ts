import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ModelDefinition } from '../../compiler/ast/types.js';
import { computeSchemaDiff, formatSchemaDiff, type SchemaDiffResult } from '../../compiler/diffing/schemaDiff.js';
import { paths as laforgePaths } from './persistence.js';
import { diffLines } from 'diff';

const HISTORY_DIR = 'history';
const ENTRY_FILE = 'entry.json';
const SCHEMA_FILE = 'schema.json';
const HEAD_FILE = 'HEAD';
const DEFAULT_BRANCH = 'main';

export type HistoryEntryKind = 'generate' | 'migrate' | 'snapshot';

export interface HistoryAttachmentInput {
  name: string;
  content: string;
  kind?: string;
  role?: 'before' | 'after';
  description?: string;
}

export interface HistoryAttachment extends Omit<HistoryAttachmentInput, 'content'> {
  hash: string;
  path: string;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  kind: HistoryEntryKind;
  branch: string;
  domainPath?: string;
  domainHash?: string;
  schemaPath: string;
  schemaHash: string;
  migrationsCreated?: string[];
  migrationsApplied?: string[];
  allowDestructive?: boolean;
  diffOperations?: number;
  autoMigrateSummary?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  attachments?: HistoryAttachment[];
}

export interface RecordHistoryInput {
  baseDir?: string;
  kind: HistoryEntryKind;
  models: ModelDefinition[];
  branch?: string;
  domainPath?: string;
  domainContent?: string;
  migrationsCreated?: string[];
  migrationsApplied?: string[];
  allowDestructive?: boolean;
  diffOperations?: number;
  autoMigrateSummary?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  attachments?: HistoryAttachmentInput[];
}

interface HistoryPaths {
  root: string;
  historyDir: string;
  head: string;
}

function historyPaths(baseDir: string): HistoryPaths {
  const laforge = laforgePaths(baseDir);
  return {
    root: laforge.root,
    historyDir: path.join(laforge.root, HISTORY_DIR),
    head: path.join(laforge.root, HISTORY_DIR, HEAD_FILE),
  };
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'attachment';
}

function normalizeBranch(name: string | undefined): string {
  return (name || DEFAULT_BRANCH).trim() || DEFAULT_BRANCH;
}

function nextId(kind: HistoryEntryKind): string {
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, '');
  const random = crypto.randomBytes(3).toString('hex');
  return `${ts}_${kind}_${random}`;
}

export async function getCurrentBranch(baseDir = process.cwd()): Promise<string> {
  const { head, historyDir } = historyPaths(baseDir);
  await fs.mkdir(historyDir, { recursive: true });
  try {
    const raw = await fs.readFile(head, 'utf8');
    const name = raw.trim();
    return name || DEFAULT_BRANCH;
  } catch {
    await fs.writeFile(head, DEFAULT_BRANCH, 'utf8');
    return DEFAULT_BRANCH;
  }
}

export async function setCurrentBranch(branch: string, baseDir = process.cwd()): Promise<void> {
  const { head, historyDir } = historyPaths(baseDir);
  await fs.mkdir(historyDir, { recursive: true });
  const name = normalizeBranch(branch);
  await fs.writeFile(head, name, 'utf8');
}

export async function listBranches(baseDir = process.cwd()): Promise<string[]> {
  const entries = await listHistoryEntries(baseDir, { all: true });
  const fromEntries = new Set(entries.map(e => e.branch));
  const head = await getCurrentBranch(baseDir).catch(() => DEFAULT_BRANCH);
  fromEntries.add(DEFAULT_BRANCH);
  fromEntries.add(head);
  return [...fromEntries].sort();
}

export async function recordHistoryEntry(input: RecordHistoryInput): Promise<HistoryEntry> {
  const baseDir = input.baseDir || process.cwd();
  const { historyDir } = historyPaths(baseDir);
  await fs.mkdir(historyDir, { recursive: true });

  const id = nextId(input.kind);
  const createdAt = new Date().toISOString();
  const branch = normalizeBranch(input.branch || (await getCurrentBranch(baseDir)));
  const entryDir = path.join(historyDir, id);
  await fs.mkdir(entryDir, { recursive: true });

  const schemaSnapshot = { version: 1, savedAt: createdAt, models: input.models };
  const schemaPath = path.join(entryDir, SCHEMA_FILE);
  await fs.writeFile(schemaPath, JSON.stringify(schemaSnapshot, null, 2), 'utf8');
  const schemaHash = hashContent(JSON.stringify(input.models));

  let domainHash: string | undefined;
  let domainRelativePath: string | undefined;
  if (input.domainContent) {
    const targetName = input.domainPath ? path.basename(input.domainPath) : 'domain.dsl';
    const targetPath = path.join(entryDir, targetName);
    await fs.writeFile(targetPath, input.domainContent, 'utf8');
    domainHash = hashContent(input.domainContent);
    domainRelativePath = path.relative(baseDir, targetPath);
  }

  const attachments: HistoryAttachment[] = [];
  if (input.attachments && input.attachments.length) {
    const attachmentsDir = path.join(entryDir, 'attachments');
    await fs.mkdir(attachmentsDir, { recursive: true });
    input.attachments.forEach((att, idx) => {
      attachments.push({
        name: att.name,
        kind: att.kind,
        role: att.role,
        description: att.description,
        hash: hashContent(att.content),
        path: path.relative(
          baseDir,
          path.join(attachmentsDir, `${idx}_${sanitizeFileName(att.name)}`),
        ),
      });
    });
    // Actually write the contents
    await Promise.all(
      attachments.map((att, idx) =>
        fs.writeFile(
          path.isAbsolute(att.path) ? att.path : path.join(baseDir, att.path),
          input.attachments![idx].content,
          'utf8',
        ),
      ),
    );
  }

  const entry: HistoryEntry = {
    id,
    createdAt,
    kind: input.kind,
    branch,
    domainPath: input.domainPath ? path.relative(baseDir, input.domainPath) : undefined,
    domainHash,
    schemaPath: path.relative(baseDir, schemaPath),
    schemaHash,
    migrationsCreated: input.migrationsCreated || [],
    migrationsApplied: input.migrationsApplied || [],
    allowDestructive: input.allowDestructive,
    diffOperations: input.diffOperations,
    autoMigrateSummary: input.autoMigrateSummary,
    notes: input.notes,
    metadata: input.metadata,
    attachments: attachments.length ? attachments : undefined,
  };

  // When we copied domain content, prefer the stored relative path for inspection.
  if (domainRelativePath) {
    entry.metadata = { ...(entry.metadata || {}), storedDomain: domainRelativePath };
  }

  await fs.writeFile(path.join(entryDir, ENTRY_FILE), JSON.stringify(entry, null, 2), 'utf8');
  return entry;
}

export async function listHistoryEntries(
  baseDir = process.cwd(),
  opts: { branch?: string; all?: boolean } = {},
): Promise<HistoryEntry[]> {
  const { historyDir } = historyPaths(baseDir);
  let dirEntries: string[];
  try {
    dirEntries = await fs.readdir(historyDir);
  } catch {
    return [];
  }

  const entries: HistoryEntry[] = [];
  for (const name of dirEntries) {
    const entryPath = path.join(historyDir, name, ENTRY_FILE);
    try {
      const raw = await fs.readFile(entryPath, 'utf8');
      entries.push(JSON.parse(raw) as HistoryEntry);
    } catch {
      continue;
    }
  }

  const branchName = opts.all ? undefined : normalizeBranch(opts.branch || (await getCurrentBranch(baseDir)));
  const filtered = branchName ? entries.filter(e => normalizeBranch(e.branch) === branchName) : entries;

  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadHistoryEntry(id: string, baseDir = process.cwd()): Promise<HistoryEntry | null> {
  const { historyDir } = historyPaths(baseDir);
  const entryPath = path.join(historyDir, id, ENTRY_FILE);
  try {
    const raw = await fs.readFile(entryPath, 'utf8');
    return JSON.parse(raw) as HistoryEntry;
  } catch {
    return null;
  }
}

export async function loadEntryModels(entry: HistoryEntry, baseDir = process.cwd()): Promise<ModelDefinition[]> {
  const schemaPath = path.isAbsolute(entry.schemaPath) ? entry.schemaPath : path.join(baseDir, entry.schemaPath);
  const raw = await fs.readFile(schemaPath, 'utf8');
  const parsed = JSON.parse(raw) as { models: ModelDefinition[] };
  return parsed.models || [];
}

async function loadAttachmentContent(att: HistoryAttachment, baseDir: string): Promise<string> {
  const fullPath = path.isAbsolute(att.path) ? att.path : path.join(baseDir, att.path);
  return fs.readFile(fullPath, 'utf8');
}

export interface AttachmentDiff {
  name: string;
  kind?: string;
  change: 'added' | 'removed' | 'modified';
  roleFrom?: string;
  roleTo?: string;
  patch?: string;
}

export interface HistoryDiff {
  from: HistoryEntry;
  to: HistoryEntry;
  diff: SchemaDiffResult;
  formatted: string;
  attachmentDiffs: AttachmentDiff[];
}

export async function cloneEntryToBranch(
  entry: HistoryEntry,
  targetBranch: string,
  opts: { baseDir?: string; notePrefix?: string } = {},
): Promise<HistoryEntry> {
  const baseDir = opts.baseDir || process.cwd();
  const models = await loadEntryModels(entry, baseDir);

  const attachments =
    entry.attachments && entry.attachments.length
      ? await Promise.all(
          entry.attachments.map(async att => ({
            name: att.name,
            kind: att.kind,
            role: att.role,
            description: att.description,
            content: await loadAttachmentContent(att, baseDir),
          })),
        )
      : undefined;

  let domainContent: string | undefined;
  if (entry.metadata?.storedDomain) {
    const domainPath = path.isAbsolute(String(entry.metadata.storedDomain))
      ? String(entry.metadata.storedDomain)
      : path.join(baseDir, String(entry.metadata.storedDomain));
    try {
      domainContent = await fs.readFile(domainPath, 'utf8');
    } catch {
      domainContent = undefined;
    }
  }

  const notes = opts.notePrefix ? `${opts.notePrefix} ${entry.id}` : entry.notes;

  return recordHistoryEntry({
    kind: 'snapshot',
    baseDir,
    models,
    branch: targetBranch,
    domainContent,
    domainPath: entry.domainPath ? path.join(baseDir, entry.domainPath) : undefined,
    migrationsCreated: entry.migrationsCreated,
    migrationsApplied: entry.migrationsApplied,
    allowDestructive: entry.allowDestructive,
    diffOperations: entry.diffOperations,
    autoMigrateSummary: entry.autoMigrateSummary,
    notes,
    metadata: entry.metadata,
    attachments,
  });
}

export async function diffHistoryEntries(
  from: HistoryEntry,
  to: HistoryEntry,
  opts: { baseDir?: string; db?: 'postgres' | 'sqlite' | 'mysql'; colors?: boolean } = {},
): Promise<HistoryDiff> {
  const baseDir = opts.baseDir || process.cwd();
  const [fromModels, toModels] = await Promise.all([loadEntryModels(from, baseDir), loadEntryModels(to, baseDir)]);
  const diff = computeSchemaDiff(fromModels, toModels, opts.db || 'postgres');
  const attachmentDiffs: AttachmentDiff[] = [];

  const fromAtt = new Map((from.attachments || []).map(a => [a.name, a]));
  const toAtt = new Map((to.attachments || []).map(a => [a.name, a]));

  for (const [name, att] of fromAtt) {
    if (!toAtt.has(name)) {
      attachmentDiffs.push({ name, kind: att.kind, change: 'removed', roleFrom: att.role });
      continue;
    }
    const other = toAtt.get(name)!;
    if (att.hash !== other.hash) {
      const [fromContent, toContent] = await Promise.all([
        loadAttachmentContent(att, baseDir),
        loadAttachmentContent(other, baseDir),
      ]);
      const patch = diffLines(fromContent, toContent)
        .map(part => {
          const prefix = part.added ? '+' : part.removed ? '-' : ' ';
          return part.value
            .split('\n')
            .filter(Boolean)
            .map(line => `${prefix}${line}`)
            .join('\n');
        })
        .filter(Boolean)
        .join('\n');
      attachmentDiffs.push({
        name,
        kind: att.kind || other.kind,
        change: 'modified',
        roleFrom: att.role,
        roleTo: other.role,
        patch,
      });
    }
  }

  for (const [name, att] of toAtt) {
    if (!fromAtt.has(name)) {
      attachmentDiffs.push({ name, kind: att.kind, change: 'added', roleTo: att.role });
    }
  }

  return {
    from,
    to,
    diff,
    formatted: formatSchemaDiff(diff, { colors: opts.colors }),
    attachmentDiffs,
  };
}

export function resolveEntrySelector(selector: string, entries: HistoryEntry[]): HistoryEntry | undefined {
  if (selector === 'latest') {
    return entries[0];
  }

  const byId = entries.find(e => e.id === selector);
  if (byId) return byId;

  if (/^\d+$/.test(selector)) {
    const idx = Number(selector);
    if (idx >= 0 && idx < entries.length) {
      return entries[idx];
    }
  }

  // allow partial id prefix match
  return entries.find(e => e.id.startsWith(selector));
}
