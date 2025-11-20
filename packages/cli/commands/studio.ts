import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { Command } from 'commander'
import Fastify, { type FastifyInstance } from 'fastify'
import { compileForSandbox, type CompilationOutput } from '../../compiler/index.js'
import { writeCompilationOutput } from './utils.js'
import { zipDirectories } from '../lib/zip.js'
import {
  listBranches,
  getCurrentBranch,
  setCurrentBranch,
  listHistoryEntries,
  diffHistoryEntries,
  cloneEntryToBranch,
  resolveEntrySelector,
  loadEntryModels,
} from '../lib/history.js'
import { listAuditEntries } from '../lib/auditStore.js'
import { verifyChain, verifySnapshot } from '../lib/signing.js'
import { generateMigrations } from '../../compiler/diffing/migrationGenerator.js'
import { DatabaseConnection } from '../../runtime/db/database.js'
import type { ModelDefinition } from '../../compiler/ast/types.js'
import type { SchemaOperation } from '../../compiler/diffing/schemaDiff.js'
import { diffLines } from 'diff'

export function registerStudioCommand(program: Command) {
  program
    .command('studio')
    .description('Launch the branch-aware LaForge Studio UI')
    .option('-p, --port <port>', 'Port to run the studio on', '4173')
    .action(async (options: { port?: string }) => {
      const port = Number(options.port ?? 4173) || 4173
      const fastify = await buildStudioServer({ baseDir: process.cwd(), port })

      try {
        await fastify.listen({ host: '0.0.0.0', port })
        console.log(`\nLaForge Studio running at http://localhost:${port}\n`)
      } catch (err: any) {
        console.error('Failed to start studio:', err.message)
        process.exitCode = 1
      }
    })
}

export async function buildStudioServer(opts: { baseDir?: string; port?: number } = {}): Promise<FastifyInstance> {
  const port = Number(opts.port ?? 4173) || 4173
  const baseDir = opts.baseDir || process.cwd()
  const fastify = Fastify({ logger: false })

  fastify.get('/', async (_, reply) => {
    reply.type('text/html').send(renderHtml(port))
  })

  fastify.post('/generate', async (request, reply) => {
    try {
      const body = request.body as { dsl?: string }
      const dsl = body?.dsl?.trim()
      if (!dsl) {
        reply.status(400).type('text/plain').send('No DSL supplied.')
        return
      }

      const started = Date.now()
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-studio-'))
      const domainPath = path.join(tmpDir, 'domain.dsl.ts')
      await fs.writeFile(domainPath, dsl, 'utf8')

      const output = compileForSandbox(dsl)
      const backendDir = path.join(tmpDir, 'generated')
      const files = await writeCompilationOutput(domainPath, output, backendDir)
      const zipPath = await zipDirectories([backendDir], path.join(tmpDir, 'laforge-output.zip'))
      const buffer = await fs.readFile(zipPath)

      const summary = buildSummary({
        dsl,
        output,
        files,
        zipPath,
        durationMs: Date.now() - started,
      })

      reply.header('Content-Type', 'application/json').send({
        summary,
        zipBase64: buffer.toString('base64'),
      })
    } catch (err: any) {
      reply.status(500).type('text/plain').send(`Generation failed: ${err.message}`)
    }
  })

  fastify.get('/api/branches', async (_req, reply) => {
    const [current, branches] = await Promise.all([getCurrentBranch(baseDir), listBranches(baseDir)])
    reply.send({ current, branches })
  })

  fastify.post('/api/branches/create', async (request, reply) => {
    const body = request.body as { name?: string }
    if (!body?.name) {
      reply.status(400).send({ error: 'Branch name required' })
      return
    }
    await setCurrentBranch(body.name, baseDir)
    const branches = await listBranches(baseDir)
    reply.send({ current: body.name, branches })
  })

  fastify.post('/api/branches/switch', async (request, reply) => {
    const body = request.body as { name?: string }
    if (!body?.name) {
      reply.status(400).send({ error: 'Branch name required' })
      return
    }
    await setCurrentBranch(body.name, baseDir)
    const branches = await listBranches(baseDir)
    reply.send({ current: body.name, branches })
  })

      fastify.get('/api/timeline', async (request, reply) => {
        const query = request.query as { branch?: string; limit?: string }
        const branch = query.branch || (await getCurrentBranch(baseDir))
        const entries = await listHistoryEntries(baseDir, { branch })
        const limitVal = query.limit ? Number(query.limit) : undefined
        reply.send({ branch, entries: typeof limitVal === 'number' ? entries.slice(0, limitVal) : entries })
      })

  fastify.get('/api/timeline/diff', async (request, reply) => {
    const query = request.query as { from?: string; to?: string; fromBranch?: string; toBranch?: string; db?: string }
    if (!query.from || !query.to) {
      reply.status(400).send({ error: 'from and to are required' })
      return
    }
    const fromBranch = query.fromBranch || (await getCurrentBranch(baseDir))
    const toBranch = query.toBranch || fromBranch
    const fromEntries = await listHistoryEntries(baseDir, { branch: fromBranch })
    const toEntries = toBranch === fromBranch ? fromEntries : await listHistoryEntries(baseDir, { branch: toBranch })
    const from = resolveEntrySelector(query.from, fromEntries)
    const to = resolveEntrySelector(query.to, toEntries)
    if (!from || !to) {
      reply.status(404).send({ error: 'Entries not found for diff' })
      return
    }
    const diff = await diffHistoryEntries(from, to, { colors: false, db: (query.db as any) || 'postgres', baseDir })
    reply.send(diff)
  })

  fastify.post('/api/timeline/cherry-pick', async (request, reply) => {
    const body = request.body as { entryId?: string; targetBranch?: string; notePrefix?: string }
    if (!body?.entryId || !body?.targetBranch) {
      reply.status(400).send({ error: 'entryId and targetBranch required' })
      return
    }
    const entries = await listHistoryEntries(baseDir, { all: true })
    const entry = resolveEntrySelector(body.entryId, entries)
    if (!entry) {
      reply.status(404).send({ error: 'Entry not found' })
      return
    }
    const cloned = await cloneEntryToBranch(entry, body.targetBranch, { notePrefix: body.notePrefix, baseDir })
    reply.send({ cloned })
  })

  fastify.post('/api/timeline/replay', async (request, reply) => {
    const body = request.body as { entryId?: string; branch?: string; db?: string }
    if (!body?.entryId) {
      reply.status(400).send({ error: 'entryId required' })
      return
    }
    const branch = body.branch || (await getCurrentBranch(baseDir))
    const entries = await listHistoryEntries(baseDir, { branch })
    const entry = resolveEntrySelector(body.entryId, entries)
    if (!entry) {
      reply.status(404).send({ error: 'Entry not found' })
      return
    }
    const models = await loadEntryModels(entry, baseDir)
    const migrations = generateMigrations(models, { previousModels: [], db: (body.db as any) || 'sqlite' })
    const db = new DatabaseConnection(':memory:')
    try {
      migrations.forEach(m => db.exec(m.content))
      reply.send({ branch, entryId: entry.id, statements: migrations.map(m => m.content) })
    } catch (err: any) {
      reply.status(500).send({ error: err?.message || 'Replay failed' })
    } finally {
      db.close()
    }
  })

  fastify.get('/api/timeline/erd', async (request, reply) => {
    const query = request.query as { entryId?: string; branch?: string }
    const branch = query.branch || (await getCurrentBranch(baseDir))
    const entries = await listHistoryEntries(baseDir, { branch })
    if (!entries.length) {
      reply.status(404).send({ error: 'No snapshots found' })
      return
    }
    const entry = query.entryId ? resolveEntrySelector(query.entryId, entries) : entries[0]
    if (!entry) {
      reply.status(404).send({ error: 'Entry not found for ERD' })
      return
    }
    const models = await loadEntryModels(entry, baseDir)
    const graph = buildErdGraph(models)
    reply.send({ branch, entryId: entry.id, ...graph })
  })

  fastify.get('/api/audit', async (request, reply) => {
    const query = request.query as { tenant?: string; model?: string; action?: string; user?: string; since?: string; limit?: string }
    const limit = query.limit ? Number(query.limit) : 100
    const entries = await listAuditEntries(
      {
        tenant: query.tenant,
        model: query.model,
        action: query.action,
        user: query.user,
        since: query.since,
      },
      { limit, baseDir },
    )
    reply.send({ entries })
  })

  fastify.get('/api/integrity', async (request, reply) => {
    const query = request.query as { branch?: string }
    const branch = query.branch || (await getCurrentBranch(baseDir))
    const entries = await listHistoryEntries(baseDir, { branch })
    const chain = await verifyChain(baseDir, branch)
    const snapshots = await Promise.all(
      entries.map(async e => ({
        id: e.id,
        createdAt: e.createdAt,
        hash: e.hash,
        prevHash: e.prevHash,
        approved: !!e.approvals?.length,
        approvals: e.approvals || [],
        verified: await verifySnapshot(e),
      })),
    )
    reply.send({ branch, chain, snapshots })
  })

  return fastify
}

export function highlightFromDiff(operations: SchemaOperation[]) {
  const changedTables = new Set<string>()
  const changedFields = new Map<string, Set<string>>()
  const changedEdges = new Set<string>()

  const addField = (table: string, field: string) => {
    if (!changedFields.has(table)) changedFields.set(table, new Set())
    changedFields.get(table)!.add(field)
  }

  for (const op of operations || []) {
    switch (op.kind) {
      case 'addTable':
      case 'dropTable':
        changedTables.add(op.table)
        break
      case 'renameTable':
        changedTables.add(op.from)
        changedTables.add(op.to)
        break
      case 'addColumn':
      case 'dropColumn':
        changedTables.add(op.table)
        addField(op.table, op.column.name)
        break
      case 'renameColumn':
        changedTables.add(op.table)
        addField(op.table, op.from)
        addField(op.table, op.to)
        break
      case 'alterColumnType':
      case 'alterNullability':
      case 'alterDefault':
        changedTables.add(op.table)
        addField(op.table, op.column)
        break
      case 'addForeignKey':
      case 'dropForeignKey':
        changedTables.add(op.fk.table)
        changedTables.add(op.fk.targetTable)
        changedEdges.add(`${op.fk.table}->${op.fk.targetTable}`)
        break
      case 'alterForeignKey':
        changedTables.add(op.from.table)
        changedTables.add(op.to.targetTable)
        changedEdges.add(`${op.from.table}->${op.from.targetTable}`)
        changedEdges.add(`${op.to.table}->${op.to.targetTable}`)
        break
      default:
        break
    }
  }

  return { changedTables, changedFields, changedEdges }
}

function renderHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>LaForge Studio - Time Travel</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
    <style>
      :root {
        --bg: #05060c;
        --panel: rgba(17, 24, 39, 0.8);
        --muted: #9ca3af;
        --accent: #00d2ff;
        --accent-2: #7c3aed;
        --text: #e5e7eb;
        --border: rgba(255,255,255,0.08);
      }
      * { box-sizing: border-box; }
      body { margin:0; min-height:100vh; background: radial-gradient(circle at 20% 20%, #0f172a 0%, #05060c 40%, #05060c 100%); color: var(--text); font-family: 'Space Grotesk', 'Inter', system-ui, -apple-system, sans-serif; }
      header { padding: 24px 32px; display:flex; justify-content:space-between; align-items:center; }
      .brand { font-weight:700; font-size: 22px; letter-spacing: 0.02em; }
      .pill { padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,0.07); color: var(--muted); border: 1px solid var(--border); display: inline-flex; align-items:center; gap:8px; }
      main { padding: 0 32px 32px; display:grid; grid-template-columns: 340px 1fr; gap: 18px; align-items:start; }
      .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 16px; backdrop-filter: blur(14px); box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
      h2 { margin: 0 0 12px; font-size: 17px; letter-spacing: 0.01em; }
      .muted { color: var(--muted); font-size: 13px; }
      .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
      select, input, textarea { width: 100%; border-radius: 12px; border: 1px solid var(--border); background: rgba(255,255,255,0.03); color: var(--text); padding: 10px 12px; font-family: 'Space Grotesk', system-ui, sans-serif; }
      button { border: none; border-radius: 12px; padding: 10px 14px; font-weight: 600; cursor: pointer; transition: transform 0.12s ease, box-shadow 0.12s ease; }
      button:active { transform: translateY(1px); }
      .btn-accent { background: linear-gradient(120deg, var(--accent), var(--accent-2)); color: #0b1022; box-shadow: 0 12px 40px rgba(0, 210, 255, 0.25); }
      .btn-ghost { background: rgba(255,255,255,0.06); color: var(--text); border: 1px solid var(--border); }
      .stack { display:flex; flex-direction:column; gap: 12px; }
      .timeline { display:flex; flex-direction:column; gap:10px; max-height: calc(100vh - 200px); overflow:auto; padding-right:4px; }
      .entry { padding: 12px; border-radius: 14px; border:1px solid var(--border); background: rgba(255,255,255,0.03); cursor:pointer; transition: border-color 0.12s ease, background 0.12s ease; }
      .entry.active { border-color: var(--accent); background: rgba(0,210,255,0.08); box-shadow: 0 10px 30px rgba(0,210,255,0.15); }
      .entry .meta { display:flex; gap:8px; flex-wrap:wrap; font-size: 12px; color: var(--muted); }
      .diff { white-space: pre-wrap; font-family: 'JetBrains Mono', monospace; font-size: 13px; background: #0a0c14; padding: 12px; border-radius: 12px; border:1px solid var(--border); color: #c7d2fe; }
      .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px,1fr)); gap:8px; }
      .card { background: rgba(255,255,255,0.03); border:1px solid var(--border); padding:12px; border-radius:12px; }
      .badge { padding: 4px 10px; border-radius: 999px; border:1px solid var(--border); font-size: 11px; color: var(--muted); }
      .hero { padding: 20px 32px 8px; }
      .hero-title { font-size: 28px; margin: 0 0 6px; letter-spacing: 0.01em; }
      .hero-sub { color: var(--muted); margin: 0; }
      .row-actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
      .changed-node { animation: pulse 1.6s ease-in-out infinite; border-color: var(--accent); box-shadow: 0 12px 40px rgba(0,210,255,0.3); }
      .changed-field { color: var(--accent); animation: glow 1.6s ease-in-out infinite; }
      @keyframes pulse { 0% { transform: translateY(0); } 50% { transform: translateY(-2px); } 100% { transform: translateY(0); } }
      @keyframes glow { 0% { text-shadow: 0 0 0px rgba(0,210,255,0.4); } 50% { text-shadow: 0 0 12px rgba(0,210,255,0.8); } 100% { text-shadow: 0 0 0px rgba(0,210,255,0.4); } }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; }
      .status-ok { color: #4ade80; }
      .status-warn { color: #facc15; }
      .status-bad { color: #f87171; }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">LaForge Studio - Time Travel</div>
      <div class="pill"><span>Port</span><strong>${port}</strong></div>
    </header>
    <section class="hero">
      <h1 class="hero-title">Branch-aware timeline for your domain.</h1>
      <p class="hero-sub">Scrub history, diff schema/attachments, cherry-pick snapshots, and replay into a sandbox DB.</p>
    </section>
    <main>
      <section class="panel stack">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <h2 style="margin:0;">Branches</h2>
          <button class="btn-ghost" id="refresh-branches">Refresh</button>
        </div>
        <div class="stack">
          <label class="muted">Current branch</label>
          <div class="row">
            <select id="branch-select"></select>
            <button class="btn-accent" id="switch-branch">Switch</button>
          </div>
        </div>
        <div class="stack">
          <label class="muted">Create branch</label>
          <div class="row">
            <input id="new-branch" placeholder="feature/time-travel" />
            <button class="btn-ghost" id="create-branch">Create</button>
          </div>
        </div>
        <hr style="border:1px solid var(--border); width:100%; opacity:0.4;" />
        <div class="row" style="justify-content:space-between; align-items:center;">
          <h2 style="margin:0;">Timeline</h2>
          <span class="badge" id="branch-label"></span>
        </div>
        <div class="timeline" id="timeline"></div>
      </section>

      <section class="panel stack">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <h2 style="margin:0;">Audit Trail</h2>
          <button class="btn-ghost" id="refresh-audit">Refresh</button>
        </div>
        <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(140px,1fr)); gap:8px;">
          <input id="audit-tenant" placeholder="tenant" />
          <input id="audit-user" placeholder="user id" />
          <input id="audit-model" placeholder="model" />
          <input id="audit-action" placeholder="action" />
          <input id="audit-since" placeholder="since (e.g., 1h)" />
          <input id="audit-limit" placeholder="limit" value="50" />
        </div>
        <div style="overflow:auto; max-height:360px;">
          <table class="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Tenant</th>
                <th>User</th>
                <th>Model</th>
                <th>Action</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody id="audit-rows">
              <tr><td colspan="6" class="muted">No audit entries yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel stack">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <h2 style="margin:0;">Integrity</h2>
          <button class="btn-ghost" id="refresh-integrity">Refresh</button>
        </div>
        <div id="integrity-summary" class="muted">Chain not verified yet.</div>
        <div style="overflow:auto; max-height:280px;">
          <table class="table">
            <thead>
              <tr>
                <th>Snapshot</th>
                <th>Hash</th>
                <th>Signature</th>
                <th>Approvals</th>
              </tr>
            </thead>
            <tbody id="integrity-rows">
              <tr><td colspan="4" class="muted">No integrity data.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel stack">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <h2 style="margin:0;">Diff & Actions</h2>
      <div class="row-actions">
            <button class="btn-ghost" id="replay-btn" disabled>Replay to sandbox</button>
            <button class="btn-ghost" id="cherry-btn" disabled>Cherry-pick</button>
            <button class="btn-ghost" id="erd-refresh">Refresh ERD</button>
            <button class="btn-ghost" id="show-blame">Blame DSL</button>
          </div>
        </div>
        <div class="row">
          <select id="entry-select" style="flex:1;"></select>
          <select id="compare-select" style="flex:1;"></select>
          <button class="btn-accent" id="diff-btn">Diff</button>
        </div>
        <div class="grid" id="summary-cards"></div>
        <div>
          <h3 style="margin:12px 0 6px;">Schema Diff</h3>
          <pre class="diff" id="diff-viewer">Select two snapshots to view the diff.</pre>
        </div>
        <div>
          <h3 style="margin:12px 0 6px;">Attachment Changes</h3>
          <pre class="diff" id="attachment-viewer">No attachment diffs.</pre>
        </div>
        <div>
          <h3 style="margin:12px 0 6px;">ERD</h3>
          <div id="erd-canvas" style="width:100%; min-height:240px; border:1px solid var(--border); border-radius:12px; padding:12px; background:#0b1020;"></div>
          <div id="erd-detail" class="muted" style="margin-top:8px; font-size:12px;">Select a table to see details.</div>
        </div>
      </section>
    </main>

    <script>
      let timelineEntries = [];
      let currentBranch = 'main';
      let downloadUrl = null;
      let latestDiffOps = [];
      let highlights = { tables:new Set(), fields: new Map(), edges: new Set() };
      let latestErd = { nodes: [], edges: [] };

      const branchSelect = document.getElementById('branch-select');
      const branchLabel = document.getElementById('branch-label');
      const newBranchInput = document.getElementById('new-branch');
      const timelineEl = document.getElementById('timeline');
      const entrySelect = document.getElementById('entry-select');
      const compareSelect = document.getElementById('compare-select');
      const diffViewer = document.getElementById('diff-viewer');
      const attachmentViewer = document.getElementById('attachment-viewer');
      const summaryCards = document.getElementById('summary-cards');
      const replayBtn = document.getElementById('replay-btn');
      const cherryBtn = document.getElementById('cherry-btn');
      const auditRows = document.getElementById('audit-rows');
      const auditTenant = document.getElementById('audit-tenant');
      const auditUser = document.getElementById('audit-user');
      const auditModel = document.getElementById('audit-model');
      const auditAction = document.getElementById('audit-action');
      const auditSince = document.getElementById('audit-since');
      const auditLimit = document.getElementById('audit-limit');
      const erdCanvas = document.getElementById('erd-canvas');
      const erdDetail = document.getElementById('erd-detail');
      const blameBtn = document.getElementById('show-blame');
      const integrityRows = document.getElementById('integrity-rows');
      const integritySummary = document.getElementById('integrity-summary');

      async function fetchJSON(url, opts) {
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      }

      async function loadAudit() {
        const params = new URLSearchParams();
        if (auditTenant.value) params.append('tenant', auditTenant.value);
        if (auditUser.value) params.append('user', auditUser.value);
        if (auditModel.value) params.append('model', auditModel.value);
        if (auditAction.value) params.append('action', auditAction.value);
        if (auditSince.value) params.append('since', auditSince.value);
        const limitVal = Number(auditLimit.value) || 50;
        params.append('limit', String(limitVal));
        const data = await fetchJSON('/api/audit?' + params.toString());
        renderAudit(data.entries || []);
      }

      function renderAudit(entries) {
        auditRows.innerHTML = '';
        if (!entries.length) {
          auditRows.innerHTML = '<tr><td colspan="6" class="muted">No audit entries found.</td></tr>';
          return;
        }
        entries.forEach(entry => {
          const tr = document.createElement('tr');
          const time = new Date(entry.timestamp).toLocaleString();
          tr.innerHTML = \`
            <td>\${time}</td>
            <td>\${entry.tenantId || ''}</td>
            <td>\${entry.userId || ''}\${entry.requestId ? \`<div class="muted">req \${entry.requestId}</div>\` : ''}</td>
            <td>\${entry.model || ''}</td>
            <td>\${entry.type}</td>
            <td style="max-width:280px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\${entry.data ? JSON.stringify(entry.data) : (entry.artifactHash || '')}</td>
          \`;
          auditRows.appendChild(tr);
        });
      }

      async function loadIntegrity() {
        const data = await fetchJSON('/api/integrity?branch=' + encodeURIComponent(currentBranch));
        renderIntegrity(data);
      }

      function renderIntegrity(data) {
        if (!data || !data.snapshots) {
          integritySummary.textContent = 'No integrity data.';
          integrityRows.innerHTML = '<tr><td colspan="4" class="muted">No integrity data.</td></tr>';
          return;
        }
        const chainOk = data.chain?.ok;
        const unsigned = (data.chain?.unsigned || []).length;
        integritySummary.innerHTML = chainOk
          ? '<span class="status-ok">Chain verified.</span> Unsigned: ' + unsigned
          : '<span class="status-bad">Chain broken' + (data.chain?.brokenAt ? ' at ' + data.chain.brokenAt : '') + '.</span>';

        integrityRows.innerHTML = '';
        if (!data.snapshots.length) {
          integrityRows.innerHTML = '<tr><td colspan="4" class="muted">No snapshots.</td></tr>';
          return;
        }
        data.snapshots.forEach(snap => {
          const sig = snap.verified ? '<span class="status-ok">verified</span>' : '<span class="status-warn">unsigned</span>';
          const approvals = snap.approvals?.length || 0;
          const row = document.createElement('tr');
          row.innerHTML =
            '<td>' +
            snap.id +
            '</td><td style=\"font-family: \\'JetBrains Mono\\', monospace; font-size:11px;\">' +
            (snap.hash || '') +
            '</td><td>' +
            sig +
            '</td><td>' +
            (approvals ? approvals + ' entries' : 'none') +
            '</td>';
          integrityRows.appendChild(row);
        });
      }

      async function loadBranches() {
        const data = await fetchJSON('/api/branches');
        currentBranch = data.current;
        branchLabel.textContent = data.current;
        branchSelect.innerHTML = '';
        data.branches.forEach(b => {
          const opt = document.createElement('option');
          opt.value = b; opt.textContent = b;
          if (b === data.current) opt.selected = true;
          branchSelect.appendChild(opt);
        });
      }

      async function switchBranch() {
        const name = branchSelect.value;
        await fetchJSON('/api/branches/switch', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
        await loadBranches();
        await loadTimeline();
        await loadIntegrity();
      }

      async function createBranch() {
        const name = newBranchInput.value.trim();
        if (!name) return;
        await fetchJSON('/api/branches/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
        newBranchInput.value = '';
        await loadBranches();
        await loadTimeline();
        await loadIntegrity();
      }

      async function loadTimeline() {
        const data = await fetchJSON('/api/timeline?branch=' + encodeURIComponent(currentBranch));
        timelineEntries = data.entries || [];
        renderTimeline();
        populateSelects();
      }

      function renderTimeline() {
        timelineEl.innerHTML = '';
        if (!timelineEntries.length) {
          timelineEl.innerHTML = '<div class="muted">No snapshots on this branch yet. Run generate/migrate to create them.</div>';
          return;
        }
        timelineEntries.forEach((entry, idx) => {
          const div = document.createElement('div');
          div.className = 'entry';
          div.dataset.id = entry.id;
          div.innerHTML = \`
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="font-weight:600;">\${entry.kind} - \${entry.id.slice(0,8)}</div>
              <span class="badge">\${new Date(entry.createdAt).toLocaleString()}</span>
            </div>
            <div class="meta">
              <span>migrations: \${(entry.migrationsCreated||[]).length}</span>
              <span>branch: \${entry.branch || 'main'}</span>
            </div>
            <div style="color:var(--muted); font-size:12px; margin-top:6px;">\${entry.notes || ''}</div>
          \`;
          div.onclick = () => {
            document.querySelectorAll('.entry').forEach(e => e.classList.remove('active'));
            div.classList.add('active');
            entrySelect.value = entry.id;
            const prev = timelineEntries[idx + 1];
            compareSelect.value = prev ? prev.id : entry.id;
            loadErd(entry.id);
          };
          timelineEl.appendChild(div);
        });
      }

      function populateSelects() {
        entrySelect.innerHTML = '';
        compareSelect.innerHTML = '';
        timelineEntries.forEach((entry, idx) => {
          const opt = document.createElement('option');
          opt.value = entry.id; opt.textContent = \`\${entry.kind} - \${entry.id.slice(0,8)}\`;
          entrySelect.appendChild(opt);
          const prev = timelineEntries[idx + 1];
          if (prev) {
            const opt2 = document.createElement('option');
            opt2.value = prev.id; opt2.textContent = \`\${prev.kind} - \${prev.id.slice(0,8)}\`;
            compareSelect.appendChild(opt2);
          }
        });
        if (timelineEntries.length) {
          entrySelect.value = timelineEntries[0].id;
          compareSelect.value = timelineEntries[1]?.id || timelineEntries[0].id;
          replayBtn.disabled = false;
          cherryBtn.disabled = false;
          loadErd(entrySelect.value);
        } else {
          replayBtn.disabled = true;
          cherryBtn.disabled = true;
        }
      }

      async function diffSelected() {
        const from = compareSelect.value;
        const to = entrySelect.value;
        if (!from || !to) return;
        const data = await fetchJSON(\`/api/timeline/diff?from=\${encodeURIComponent(from)}&to=\${encodeURIComponent(to)}&fromBranch=\${encodeURIComponent(currentBranch)}&toBranch=\${encodeURIComponent(currentBranch)}\`);
        latestDiffOps = data.diff?.operations || [];
        highlights = computeHighlights(latestDiffOps);
        diffViewer.textContent = data.formatted || 'No diff';
        if (data.attachmentDiffs?.length) {
          attachmentViewer.textContent = data.attachmentDiffs.map(att => {
            return \`\${att.change.toUpperCase()} - \${att.name}\${att.kind ? ' ('+att.kind+')' : ''}\\n\${att.patch || ''}\`;
          }).join('\\n\\n');
        } else {
          attachmentViewer.textContent = 'No attachment diffs.';
        }
        summaryCards.innerHTML = '';
        const cards = [
          { label: 'From', value: from.slice(0,8) },
          { label: 'To', value: to.slice(0,8) },
          { label: 'Ops', value: data.diff?.operations?.length ?? 0 },
          { label: 'Warnings', value: data.diff?.warnings?.length ?? 0 },
        ];
        cards.forEach(c => {
          const div = document.createElement('div');
          div.className = 'card';
          div.innerHTML = \`<div class="muted" style="font-size:11px; text-transform:uppercase;">\${c.label}</div><div style="font-size:20px;font-weight:700;">\${c.value}</div>\`;
          summaryCards.appendChild(div);
        });
      }

      async function replayEntry() {
        const to = entrySelect.value;
        if (!to) return;
        await fetchJSON('/api/timeline/replay', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ entryId: to, branch: currentBranch }),
        });
        alert('Snapshot replayed into sandbox SQLite (:memory:).');
      }

      async function cherryPick() {
        const to = entrySelect.value;
        if (!to) return;
        const target = prompt('Cherry-pick into branch:', currentBranch);
        if (!target) return;
        await fetchJSON('/api/timeline/cherry-pick', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ entryId: to, targetBranch: target }),
        });
        alert('Cherry-picked into ' + target);
      }

      async function blameDsl(toEntryId, fromEntryId) {
        if (!toEntryId) return;
        const diffData = await fetchJSON(\`/api/timeline/diff?from=\${encodeURIComponent(fromEntryId || toEntryId)}&to=\${encodeURIComponent(toEntryId)}&fromBranch=\${encodeURIComponent(currentBranch)}&toBranch=\${encodeURIComponent(currentBranch)}&json=true\`);
        const ops = diffData.diff?.operations || [];
        let blameText = 'DSL Blame (schema-level):\\n';
        ops.forEach(op => {
          switch (op.kind) {
            case 'addTable':
              blameText += \`+ Added table \${op.table}\\n\`; break;
            case 'addColumn':
              blameText += \`+ Added column \${op.table}.\${op.column.name}\\n\`; break;
            case 'renameColumn':
              blameText += \`~ Renamed column \${op.table}.\${op.from} -> \${op.to}\\n\`; break;
            case 'renameTable':
              blameText += \`~ Renamed table \${op.from} -> \${op.to}\\n\`; break;
            case 'dropColumn':
              blameText += \`! Dropped column \${op.table}.\${op.column.name}\\n\`; break;
            default:
              blameText += \`~ \${op.kind}\\n\`; break;
          }
        });
        alert(blameText || 'No changes.');
      }

      async function loadErd(entryId) {
        if (!entryId) return;
        const data = await fetchJSON(\`/api/timeline/erd?entryId=\${encodeURIComponent(entryId)}&branch=\${encodeURIComponent(currentBranch)}\`);
        latestErd = data;
        renderErd(data, highlights);
      }

      function renderErd(graph, hl = { tables:new Set(), fields:new Map(), edges:new Set() }) {
        erdCanvas.innerHTML = '';
        erdDetail.textContent = 'Select a table to see details.';
        if (!graph.nodes?.length) {
          erdCanvas.textContent = 'No tables in this snapshot.';
          return;
        }
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fit,minmax(180px,1fr))';
        grid.style.gap = '10px';
        graph.nodes.forEach(node => {
          const card = document.createElement('div');
          card.className = 'card' + (hl.tables.has(node.name) ? ' changed-node' : '');
          card.style.cursor = 'pointer';
          const fieldLines = node.fields.map(f => {
            const changed = hl.fields.get(node.name)?.has(f.name);
            const cls = changed ? 'changed-field' : 'muted';
            return \`<div class="\${cls}" data-field="\${f.name}">\${f.name}: \${f.type}\${f.optional ? ' (optional)' : ''}</div>\`;
          }).join('');
          card.innerHTML = \`<div style="font-weight:700;">\${node.name}</div><div class="muted" style="font-size:12px;margin-top:4px;">\${node.fields.length} fields</div><div style="margin-top:8px; font-size:12px; line-height:1.4;">\${fieldLines}</div>\`;
          card.onclick = (e) => {
            const targetField = (e.target as HTMLElement).dataset?.field;
            renderErdDetail(node, graph.edges, targetField);
          };
          grid.appendChild(card);
        });
        erdCanvas.appendChild(grid);
      }

      function renderErdDetail(node, edges, targetField) {
        const out = edges.filter(e => e.from === node.name);
        const incoming = edges.filter(e => e.to === node.name && e.from !== node.name);
        const fields = node.fields.map(f => {
          const mark = targetField && f.name === targetField ? ' *selected* ' : '';
          return \`\${f.name}: \${f.type}\${f.optional ? ' (optional)' : ''}\${mark}\`;
        }).join('\\n');
        const rels = out.map(e => \`-> \${e.kind} \${e.to} via \${e.via || ''}\`).concat(incoming.map(e => \`<- \${e.kind} \${e.from} via \${e.via || ''}\`)).join('\\n') || 'No relations';
        erdDetail.textContent = \`\${node.name}\\nFields:\\n\${fields}\\nRelations:\\n\${rels}\`;
      }

      function computeHighlights(ops) {
        const tables = new Set();
        const fields = new Map();
        const edges = new Set();
        const addField = (t, f) => {
          if (!fields.has(t)) fields.set(t, new Set());
          fields.get(t).add(f);
        };
        (ops || []).forEach(op => {
          switch (op.kind) {
            case 'addTable':
            case 'dropTable':
              tables.add(op.table); break;
            case 'renameTable':
              tables.add(op.from); tables.add(op.to); break;
            case 'addColumn':
            case 'dropColumn':
              tables.add(op.table); addField(op.table, op.column.name); break;
            case 'renameColumn':
              tables.add(op.table); addField(op.table, op.from); addField(op.table, op.to); break;
            case 'alterColumnType':
            case 'alterNullability':
            case 'alterDefault':
              tables.add(op.table); addField(op.table, op.column); break;
            case 'addForeignKey':
            case 'dropForeignKey':
              tables.add(op.fk.table); tables.add(op.fk.targetTable); edges.add(\`\${op.fk.table}->\${op.fk.targetTable}\`); break;
            case 'alterForeignKey':
              tables.add(op.from.table); tables.add(op.to.targetTable); edges.add(\`\${op.from.table}->\${op.from.targetTable}\`); edges.add(\`\${op.to.table}->\${op.to.targetTable}\`); break;
            default:
              break;
          }
        });
        return { tables, fields, edges };
      }

      document.getElementById('switch-branch').onclick = switchBranch;
      document.getElementById('create-branch').onclick = createBranch;
      document.getElementById('refresh-branches').onclick = async () => { await loadBranches(); await loadTimeline(); };
      document.getElementById('refresh-audit').onclick = loadAudit;
      document.getElementById('refresh-integrity').onclick = loadIntegrity;
      document.getElementById('diff-btn').onclick = diffSelected;
      replayBtn.onclick = replayEntry;
      cherryBtn.onclick = cherryPick;
      document.getElementById('erd-refresh').onclick = () => loadErd(entrySelect.value);
      blameBtn.onclick = () => blameDsl(entrySelect.value, compareSelect.value);

      (async () => {
        await loadBranches();
        await loadTimeline();
        await loadAudit();
        await loadIntegrity();
        await diffSelected();
      })();
    </script>
  </body>
</html>`
}

function buildSummary(params: { dsl: string; output: CompilationOutput; files: string[]; zipPath: string; durationMs: number }) {
  const { dsl, output, files, zipPath, durationMs } = params
  const dslLines = dsl.split(/\r?\n/).filter(Boolean).length
  const modelNames = output.models?.map(m => m.name) || []
  const policiesCount = output.models?.reduce((acc, model) => acc + Object.keys(model.policies || {}).length, 0) || 0
  const hooksCount = output.models?.reduce((acc, model) => acc + (model.hooks?.length || 0), 0) || 0
  const filesCount = files.length
  const totalLines =
    countLines(output.sql) +
    countLines(output.rls) +
    countLines(output.zod) +
    countLines(output.domain) +
    countLines(output.routes) +
    (output.migrations || []).reduce((acc, m) => acc + countLines(m.content), 0)

  const filesPreview = buildFilePreview(files)

  return {
    dslLines,
    modelNames,
    policiesCount,
    hooksCount,
    filesCount,
    totalLines,
    filesPreview,
    durationMs,
    zipName: path.basename(zipPath),
    zipSizeKB: undefined,
    dslText: dsl,
  }
}

function countLines(value?: string) {
  if (!value) return 0
  return value.split(/\r?\n/).filter(Boolean).length
}

function buildFilePreview(files: string[]) {
  const backendLabel = 'backend'
  return files
    .sort()
    .slice(0, 10)
    .map(file => {
      const rel = file.replace(/\\\\/g, '/')
      const idx = rel.lastIndexOf('/generated/')
      const display =
        idx !== -1
          ? `${backendLabel}/${rel.substring(idx + '/generated/'.length)}`
          : `${backendLabel}/${path.basename(rel)}`
      return display
    })
}

function buildErdGraph(models: ModelDefinition[]) {
  const nodes = models.map(model => {
    const fields = Object.entries(model.schema)
      .filter(([_, v]) => typeof v !== 'object' || !(v as any).__typeName)
      .map(([name, value]) => ({
        name,
        type: typeof value === 'object' ? (value as any).type : value,
        optional: typeof value === 'object' ? !!(value as any).optional : false,
        primaryKey: typeof value === 'object' ? !!(value as any).primaryKey : false,
      }))
    return { name: model.name, fields }
  })

  const edges: Array<{ from: string; to: string; kind: string; via?: string; inferred?: boolean }> = []
  const modelByName = new Map(models.map(m => [m.name, m]))

  for (const model of models) {
    for (const rel of model.relations) {
      if (rel.type === 'belongsTo') {
        edges.push({ from: model.name, to: rel.targetModelName, kind: 'belongsTo', via: rel.foreignKey })
        // inferred inbound edge for visualization
        edges.push({ from: rel.targetModelName, to: model.name, kind: 'inbound', via: rel.foreignKey, inferred: true })
      } else if (rel.type === 'hasMany') {
        edges.push({ from: model.name, to: rel.targetModelName, kind: 'hasMany', via: rel.foreignKey })
      } else if (rel.type === 'manyToMany') {
        edges.push({ from: model.name, to: rel.targetModelName, kind: 'manyToMany', via: rel.through })
      }
    }
  }

  // add inferred inbound for any missing reverse belongsTo
  for (const model of models) {
    for (const other of models) {
      if (model.name === other.name) continue
      const inbound = other.relations.filter(r => r.type === 'belongsTo' && r.targetModelName === model.name)
      if (inbound.length && !edges.some(e => e.from === model.name && e.to === other.name && e.inferred)) {
        edges.push({ from: model.name, to: other.name, kind: 'inbound', via: inbound[0].foreignKey, inferred: true })
      }
    }
  }

  return { nodes, edges }
}

