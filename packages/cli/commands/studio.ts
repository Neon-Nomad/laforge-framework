import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { Command } from 'commander'
import Fastify, { type FastifyInstance } from 'fastify'
import { build as esbuildBuild } from 'esbuild'
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
  historyPaths,
} from '../lib/history.js'
import { recordApproval } from '../lib/approvals.js'
import { listAuditEntries } from '../lib/auditStore.js'
import { verifyChain, verifySnapshot } from '../lib/signing.js'
import { createKmsProvider } from '../../runtime/kms.js'
import { rotateEnc2Tokens, makeKmsProviderFromConfig } from '../lib/kms.js'
import { generateMigrations } from '../../compiler/diffing/migrationGenerator.js'
import { DatabaseConnection } from '../../runtime/db/database.js'
import type { ModelDefinition } from '../../compiler/ast/types.js'
import type { SchemaOperation } from '../../compiler/diffing/schemaDiff.js'
import { diffLines } from 'diff'
import { metrics, recordHttpRequest } from '../../runtime/metrics.js'
import { withSpan } from '../../runtime/tracing.js'
import { verifyProvenance } from '../lib/provenance.js'
import { detectDrift } from '../../runtime/drift.js'
import { isApproved } from '../lib/approvals.js'

type DriftSnapshot = {
  enabled: boolean
  reason?: string
  compiledPath?: string
  dbPath?: string
  drift?: Array<{ table: string; missingColumns: string[]; extraColumns: string[] }>
}

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
  const { governanceBundlePath, auditIntegrityBundlePath } = await ensureGovernanceBundles()

  fastify.addHook('onRequest', (request, _reply, done) => {
    ;(request as any).metricsStart = Date.now()
    done()
  })

  fastify.addHook('onResponse', (request, reply, done) => {
    const started = (request as any).metricsStart as number | undefined
    const duration = started ? Date.now() - started : 0
    const routeLabel = request.routeOptions?.url || request.url
    recordHttpRequest('studio', routeLabel, request.method, reply.statusCode, duration)
    done()
  })

  fastify.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4').send(metrics.exportPrometheus())
  })

  fastify.get('/api/studio/metrics', async (_req, reply) => {
    const focus = [
      'laforge_waf_blocks_total',
      'laforge_rate_limit_blocks_total',
      'laforge_policy_rejects_total',
      'laforge_policy_chaos_failures_total',
    ]
    reply.send(metrics.snapshot(focus))
  })

  fastify.get('/', async (_, reply) => {
    reply.type('text/html').send(renderHtml(port))
  })

  fastify.get('/governance', async (_req, reply) => {
    reply.type('text/html').send(renderGovernanceHtml())
  })

  fastify.get('/laforge-governance.js', async (_req, reply) => {
    const body = await fs.readFile(governanceBundlePath, 'utf8')
    reply.type('application/javascript').send(body)
  })

  fastify.get('/laforge-audit-integrity.js', async (_req, reply) => {
    const body = await fs.readFile(auditIntegrityBundlePath, 'utf8')
    reply.type('application/javascript').send(body)
  })

  fastify.get('/health', async (_req, reply) => {
    reply.send({ status: 'ok', message: 'Studio server is running', port })
  })

  fastify.get('/ready', async (_req, reply) => {
    try {
      await getCurrentBranch(baseDir)
      reply.send({ status: 'ok', baseDir })
    } catch (err: any) {
      reply.code(503).send({ status: 'error', message: err?.message || 'unready' })
    }
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

      const output = await withSpan('studio.generate.compile', { route: '/generate' }, async () => compileForSandbox(dsl))
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
        const query = request.query as { tenant?: string; model?: string; action?: string; type?: string; user?: string; since?: string; limit?: string }
        const limit = query.limit ? Number(query.limit) : 100
        const entries = await listAuditEntries(
          {
            tenant: query.tenant,
            model: query.model,
            action: query.action,
            type: query.type || query.action,
            user: query.user,
            since: query.since,
          },
          { limit, baseDir },
        )
        reply.send({ entries })
      })

      fastify.get('/api/kms/health', async (_request, reply) => {
        const kms = createKmsProvider()
        const health = await kms.health()
        reply.send({ provider: kms.provider, version: kms.version, ok: health.ok, message: health.message })
      })

      fastify.post('/api/kms/rotate', async (request, reply) => {
        const body = request.body as { tokens?: string[]; provider?: string; version?: string; key?: string }
        const tokens = (body.tokens || []).filter(Boolean)
        if (!tokens.length) {
          reply.code(400).send({ error: 'tokens are required (enc2 strings)' })
          return
        }
        const kms = makeKmsProviderFromConfig({ provider: body.provider, version: body.version, keyId: body.key, keyName: body.key })
        const rotated = await rotateEnc2Tokens(tokens, kms, body.version)
        reply.send({ rotated, provider: kms.provider, version: kms.version || body.version })
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

  fastify.get('/api/provenance', async (_request, reply) => {
    const prov = await verifyProvenance({ baseDir })
    reply.send(prov)
  })

  fastify.get('/api/deploy/verify', async (request, reply) => {
    const query = request.query as { branch?: string; requireSigned?: string; requireApproved?: string; requireProvenance?: string }
    const branch = query.branch || (await getCurrentBranch(baseDir))
    const requireSigned = query.requireSigned === 'true'
    const requireApproved = query.requireApproved === 'true'
    const requireProvenance = query.requireProvenance === 'true'

    const results: Record<string, any> = {}

    if (requireSigned) {
      const chain = await verifyChain(baseDir, branch)
      results.signed = chain
      if (!chain.ok) {
        reply.code(400).send({ ok: false, reason: 'chain', chain })
        return
      }
    }

    if (requireApproved) {
      const entries = await listHistoryEntries(baseDir, { branch })
      const latest = entries[0]
      results.approved = { ok: !!(latest && isApproved(latest)), latest: latest?.id }
      if (!latest || !isApproved(latest)) {
        reply.code(400).send({ ok: false, reason: 'approval' })
        return
      }
    }

    if (requireProvenance) {
      const prov = await verifyProvenance({ baseDir })
      results.provenance = prov
      if (!prov.ok) {
        reply.code(400).send({ ok: false, reason: 'provenance', prov })
        return
      }
    }

    reply.send({
      ok: true,
      branch,
      signedChecked: requireSigned,
      approvedChecked: requireApproved,
      provenanceChecked: requireProvenance,
      results,
    })
  })

  fastify.get('/api/approvals', async (request, reply) => {
    const query = request.query as { branch?: string }
    const branch = query.branch || (await getCurrentBranch(baseDir))
    const entries = await listHistoryEntries(baseDir, { branch })
    const items = entries.map(e => ({
      id: e.id,
      createdAt: e.createdAt,
      branch: e.branch,
      hash: e.hash,
      approvals: e.approvals || [],
      approved: !!(e.approvals && e.approvals.length && e.approvals[e.approvals.length - 1].decision === 'approved'),
    }))
    reply.send({ branch, items })
  })

  fastify.post('/api/approvals/decision', async (request, reply) => {
    const body = request.body as { id?: string; decision?: 'approved' | 'rejected' | 'annotated'; reason?: string; actor?: string; sign?: boolean }
    if (!body?.id || !body?.decision) {
      reply.code(400).send({ error: 'id and decision required' })
      return
    }
    try {
      const approval = await recordApproval(body.id, body.decision, {
        baseDir,
        reason: body.reason,
        actor: body.actor,
        sign: !!body.sign,
      })
      reply.send({ approval })
    } catch (err: any) {
      reply.code(400).send({ error: err?.message || 'approval failed' })
    }
  })

  fastify.get('/api/drift', async (_request, reply) => {
    const snapshot = await computeDriftSnapshot(baseDir)
    reply.send(snapshot)
  })

  fastify.get('/api/migrations', async (request, reply) => {
    const query = request.query as { branch?: string }
    const branch = query.branch || (await getCurrentBranch(baseDir))
    const entries = await listHistoryEntries(baseDir, { branch })
    const items = await Promise.all(
      entries.map(async e => ({
        id: e.id,
        branch: e.branch,
        kind: e.kind,
        createdAt: e.createdAt,
        migrationsCreated: e.migrationsCreated || [],
        migrationsApplied: e.migrationsApplied || [],
        verified: e.signature ? await verifySnapshot(e) : Boolean(e.hash),
        applyStatus: (e.metadata as any)?.applyStatus,
      })),
    )
    reply.send({ branch, items })
  })

  fastify.get('/api/incidents/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })
    reply.raw.flushHeaders?.()
    reply.raw.write('\n')

    const send = (event: string, payload: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
    }

    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeatTimer)
      clearInterval(auditTimer)
      clearInterval(driftTimer)
      clearInterval(historyTimer)
      reply.raw.end()
    }
    request.raw.on('close', close)
    request.raw.on('error', close)

    let lastAuditId: string | null = null
    let lastHistoryId: string | null = null

    const pollAudit = async () => {
      if (closed) return
      try {
        const entries = await listAuditEntries({}, { baseDir, limit: 20 })
        if (!entries.length) return
        if (!lastAuditId) {
          lastAuditId = entries[0].id
          send('audit_snapshot', entries)
          return
        }
        const newest = entries[0].id
        if (newest === lastAuditId) return
        const reversed = entries.slice().reverse()
        const fresh: typeof entries = []
        for (const entry of reversed) {
          if (entry.id === lastAuditId) {
            break
          }
          fresh.push(entry)
        }
        lastAuditId = newest
        fresh.forEach(entry => send('audit_event', entry))
      } catch (err: any) {
        send('incident_error', { source: 'audit', message: err?.message || String(err) })
      }
    }

    const pollDrift = async () => {
      if (closed) return
      try {
        const snapshot = await computeDriftSnapshot(baseDir)
        send('drift_status', { timestamp: new Date().toISOString(), snapshot })
      } catch (err: any) {
        send('incident_error', { source: 'drift', message: err?.message || String(err) })
      }
    }

    const pollHistory = async () => {
      if (closed) return
      try {
        const branch = await getCurrentBranch(baseDir)
        const entries = await listHistoryEntries(baseDir, { branch })
        if (!entries.length) return
        if (!lastHistoryId) {
          lastHistoryId = entries[0].id
          return
        }
        const newest = entries[0].id
        if (newest === lastHistoryId) return
        lastHistoryId = newest
        const entry = entries[0]
        send('policy_event', { entry, branch })
      } catch (err: any) {
        send('incident_error', { source: 'policy', message: err?.message || String(err) })
      }
    }

    const heartbeatTimer = setInterval(() => send('heartbeat', { ts: Date.now() }), 15000)
    const auditTimer = setInterval(pollAudit, 4000)
    const driftTimer = setInterval(pollDrift, 15000)
    const historyTimer = setInterval(pollHistory, 6000)

    await Promise.allSettled([pollAudit(), pollDrift(), pollHistory()])
  })

  fastify.post('/api/migrations/rollback', async (request, reply) => {
    const body = request.body as { id?: string; branch?: string; out?: string }
    if (!body?.id) {
      reply.code(400).send({ error: 'id required' })
      return
    }
    const branch = body.branch || (await getCurrentBranch(baseDir))
    const entries = await listHistoryEntries(baseDir, { branch })
    const target = resolveEntrySelector(body.id, entries)
    if (!target) {
      reply.code(404).send({ error: 'snapshot not found' })
      return
    }
    const verified = target.signature ? await verifySnapshot(target) : Boolean(target.hash)
    if (!verified) {
      reply.code(400).send({ error: 'snapshot failed verification' })
      return
    }
    const { historyDir } = historyPaths(baseDir)
    const entryDir = path.join(historyDir, target.id)
    const outRoot = path.isAbsolute(body.out || '') ? (body.out as string) : path.join(baseDir, body.out || '.laforge/rollback')
    const outDir = path.join(outRoot, target.id)
    await fs.mkdir(outRoot, { recursive: true })
    await fs.cp(entryDir, outDir, { recursive: true })
    reply.send({ id: target.id, branch: target.branch, verified, bundle: outDir })
  })

  fastify.post('/api/migrations/apply', async (request, reply) => {
    const body = request.body as { id?: string; branch?: string }
    if (!body?.id) {
      reply.code(400).send({ error: 'id required' })
      return
    }
    const branch = body.branch || (await getCurrentBranch(baseDir))
    const entries = await listHistoryEntries(baseDir, { branch })
    const target = resolveEntrySelector(body.id, entries)
    if (!target) {
      reply.code(404).send({ error: 'snapshot not found' })
      return
    }
    const verified = target.signature ? await verifySnapshot(target) : Boolean(target.hash)
    if (!verified) {
      reply.code(400).send({ error: 'snapshot failed verification' })
      return
    }
    const { historyDir } = historyPaths(baseDir)
    const entryPath = path.join(historyDir, target.id, 'entry.json')
    try {
      await fs.writeFile(
        entryPath,
        JSON.stringify(
          {
            ...target,
            metadata: { ...(target.metadata || {}), applyStatus: { appliedAt: new Date().toISOString() } },
          },
          null,
          2,
        ),
        'utf8',
      )
    } catch {
      // best effort
    }
    reply.send({ id: target.id, branch: target.branch, verified, applied: true })
  })

  fastify.get('/api/policy-impact', async (request, reply) => {
    const query = request.query as { from?: string; to?: string; branch?: string }
    const branch = query.branch || (await getCurrentBranch(baseDir))
    const entries = await listHistoryEntries(baseDir, { branch })
    const from = query.from ? resolveEntrySelector(query.from, entries) : entries[1]
    const to = query.to ? resolveEntrySelector(query.to, entries) : entries[0]
    if (!from || !to) {
      reply.code(404).send({ error: 'Entries not found for policy impact' })
      return
    }
    const diff = await diffHistoryEntries(from, to, { baseDir, colors: false })
    const policyDiffs = (diff.attachmentDiffs || []).filter(att => {
      const name = att.name.toLowerCase()
      const kind = (att.kind || '').toLowerCase()
      return name.includes('policy') || name.includes('rls') || kind.includes('policy') || kind.includes('rls')
    })
    let added = 0
    let removed = 0
    policyDiffs.forEach(att => {
      if (!att.patch) return
      att.patch.split('\n').forEach(line => {
        if (line.startsWith('+')) added++
        if (line.startsWith('-')) removed++
      })
    })
    const attachments = policyDiffs.map(att => {
      const patchSnippet = (att.patch || '')
        .split('\n')
        .filter(Boolean)
        .slice(0, 30)
        .join('\n')
      return { ...att, patchSnippet }
    })

    reply.send({
      from: from.id,
      to: to.id,
      added,
      removed,
      modified: policyDiffs.length,
      attachments,
    })
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
      <div class="row" style="gap:8px; align-items:center;">
        <a class="pill" href="/governance" target="_blank" style="text-decoration:none;">Governance Suite</a>
        <div class="pill"><span>Port</span><strong>${port}</strong></div>
      </div>
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

      <div id="laforge-audit-integrity-root"></div>

      <section class="panel stack">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <h2 style="margin:0;">Approvals & Drift</h2>
          <button class="btn-ghost" id="refresh-ops">Refresh</button>
        </div>
        <div class="grid" id="drift-cards" style="grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap:8px;"></div>
        <div style="overflow:auto; max-height:240px;">
          <table class="table">
            <thead>
              <tr>
                <th>Snapshot</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Latest decision</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="approval-rows">
              <tr><td colspan="5" class="muted">No snapshots yet.</td></tr>
            </tbody>
          </table>
        </div>
        <div style="overflow:auto; max-height:200px; margin-top:10px;">
          <table class="table">
            <thead>
              <tr>
                <th>Snapshot</th>
                <th>Created</th>
                <th>Migrations</th>
                <th>Verified</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="migration-rows">
              <tr><td colspan="5" class="muted">No migration entries.</td></tr>
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
          <h3 style="margin:12px 0 6px;">Policy/RLS Impact</h3>
          <div id="policy-impact" class="grid" style="grid-template-columns: repeat(auto-fit, minmax(180px,1fr)); gap:8px;"></div>
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
      <section class="panel stack" id="operator-mode-panel">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <h2 style="margin:0;">Operator Mode</h2>
          <a class="btn-ghost" href="/governance" target="_blank">Open fullscreen</a>
        </div>
        <div id="laforge-governance-root" style="border:1px solid var(--border); border-radius:14px; min-height:320px; padding:12px;">
          <div class="muted">Loading governance console…</div>
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
      const erdCanvas = document.getElementById('erd-canvas');
      const erdDetail = document.getElementById('erd-detail');
      const blameBtn = document.getElementById('show-blame');
      const approvalRows = document.getElementById('approval-rows');
      const driftCards = document.getElementById('drift-cards');
      const migrationRows = document.getElementById('migration-rows');
      const policyImpact = document.getElementById('policy-impact');

      function escapeHtml(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      async function fetchJSON(url, opts) {
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      }

      async function loadApprovals() {
        const data = await fetchJSON('/api/approvals?branch=' + encodeURIComponent(currentBranch));
        renderApprovals(data.items || []);
      }

      async function submitDecision(id, decision) {
        const reason = prompt(\`Reason for \${decision}?\`) || '';
        await fetchJSON('/api/approvals/decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, decision, reason }),
        });
        await loadApprovals();
      }

      function renderApprovals(items) {
        approvalRows.innerHTML = '';
        if (!items.length) {
          approvalRows.innerHTML = '<tr><td colspan="5" class="muted">No snapshots found.</td></tr>';
          return;
        }
        items.forEach(item => {
          const latest = (item.approvals || [])[item.approvals.length - 1];
          const status = item.approved ? '<span class="status-ok">approved</span>' : '<span class="status-warn">pending</span>';
          const row = document.createElement('tr');
          const decisionText = latest ? \`\${latest.decision} @ \${new Date(latest.timestamp).toLocaleString()}\` : 'none';
          const actions =
            item.approved
              ? '<span class="muted">--</span>'
              : \`<button class="btn-ghost" data-id="\${item.id}" data-action="approved">Approve</button><button class="btn-ghost" data-id="\${item.id}" data-action="rejected">Reject</button>\`;
          row.innerHTML = \`
            <td>\${item.id}</td>
            <td>\${item.branch || ''}</td>
            <td>\${status}</td>
            <td>\${decisionText}</td>
            <td class="row-actions">\${actions}</td>
          \`;
          approvalRows.appendChild(row);
        });
        approvalRows.querySelectorAll('button[data-action]').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const action = btn.getAttribute('data-action');
            if (id && action) {
              submitDecision(id, action);
            }
          });
        });
      }

     async function loadDrift() {
       const data = await fetchJSON('/api/drift');
       renderDrift(data);
     }

      function renderDrift(data) {
        driftCards.innerHTML = '';
        if (!data || data.enabled === false) {
          driftCards.innerHTML = '<div class="card muted">Drift check unavailable (' + (data?.reason || 'not configured') + ')</div>';
          return;
        }
        const missing = data.drift?.filter(d => (d.missingColumns || []).length || (d.extraColumns || []).length) || [];
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = \`
          <div class="muted" style="font-size:11px; text-transform:uppercase;">Drift</div>
          <div style="font-size:18px; font-weight:700;">\${missing.length ? missing.length + ' tables with drift' : 'no drift detected'}</div>
          <div class="muted" style="font-size:12px;">DB: \${data.dbPath}</div>
        \`;
        driftCards.appendChild(card);
      }

      async function loadMigrations() {
        const data = await fetchJSON('/api/migrations?branch=' + encodeURIComponent(currentBranch));
        renderMigrations(data.items || []);
      }

      async function triggerRollback(id) {
        await fetchJSON('/api/migrations/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        alert('Rollback bundle prepared.');
      }

      async function triggerApply(id) {
        await fetchJSON('/api/migrations/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        alert('Apply check passed.');
      }

      function renderMigrations(items) {
        migrationRows.innerHTML = '';
        if (!items.length) {
          migrationRows.innerHTML = '<tr><td colspan="5" class="muted">No migration entries.</td></tr>';
          return;
        }
        items.forEach(item => {
          const row = document.createElement('tr');
          const migCount = (item.migrationsCreated || []).length || (item.migrationsApplied || []).length;
          row.innerHTML = \`
            <td>\${item.id}</td>
            <td>\${new Date(item.createdAt).toLocaleString()}</td>
            <td>\${migCount}</td>
            <td>\${item.verified ? '<span class="status-ok">yes</span>' : '<span class="status-warn">unknown</span>'}<div class="muted">\${item.applyStatus?.appliedAt ? 'applied ' + new Date(item.applyStatus.appliedAt).toLocaleString() : ''}</div></td>
            <td class="row-actions">
              <button class="btn-ghost" data-apply="\${item.id}">Apply</button>
              <button class="btn-ghost" data-roll="\${item.id}">Rollback</button>
            </td>
          \`;
          migrationRows.appendChild(row);
        });
        migrationRows.querySelectorAll('button[data-roll]').forEach(btn => {
          btn.addEventListener('click', () => triggerRollback(btn.getAttribute('data-roll')));
        });
        migrationRows.querySelectorAll('button[data-apply]').forEach(btn => {
          btn.addEventListener('click', () => triggerApply(btn.getAttribute('data-apply')));
        });
      }

      async function loadPolicyImpact(from, to) {
        const data = await fetchJSON(\`/api/policy-impact?from=\${encodeURIComponent(from)}&to=\${encodeURIComponent(to)}&branch=\${encodeURIComponent(currentBranch)}\`);
        renderPolicyImpact(data);
      }

      function renderPolicyImpact(data) {
        policyImpact.innerHTML = '';
        if (!data || data.modified === undefined) {
          policyImpact.innerHTML = '<div class="card muted">No policy impact.</div>';
          return;
        }
        const cards = [
          { label: 'Modified attachments', value: data.modified },
          { label: 'Lines added', value: data.added },
          { label: 'Lines removed', value: data.removed },
        ];
        cards.forEach(c => {
          const div = document.createElement('div');
          div.className = 'card';
          div.innerHTML = \`<div class="muted" style="font-size:11px; text-transform:uppercase;">\${c.label}</div><div style="font-size:18px;font-weight:700;">\${c.value}</div>\`;
          policyImpact.appendChild(div);
        });
        if (Array.isArray(data.attachments)) {
          data.attachments.slice(0, 3).forEach(att => {
            const div = document.createElement('div');
            div.className = 'card';
            div.innerHTML = \`<div class="muted" style="font-size:11px; text-transform:uppercase;">\${att.name}</div><pre class="diff" style="white-space:pre-wrap; font-size:11px; max-height:160px; overflow:auto;">\${att.patchSnippet || ''}</pre>\`;
            policyImpact.appendChild(div);
          });
        }
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
      }

      async function createBranch() {
        const name = newBranchInput.value.trim();
        if (!name) return;
        await fetchJSON('/api/branches/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
        newBranchInput.value = '';
        await loadBranches();
        await loadTimeline();
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

        await loadPolicyImpact(from, to);
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
      document.getElementById('refresh-ops').onclick = async () => { await loadApprovals(); await loadDrift(); await loadMigrations(); };
      document.getElementById('diff-btn').onclick = diffSelected;
      replayBtn.onclick = replayEntry;
      cherryBtn.onclick = cherryPick;
      document.getElementById('erd-refresh').onclick = () => loadErd(entrySelect.value);
      blameBtn.onclick = () => blameDsl(entrySelect.value, compareSelect.value);

      (async () => {
        await loadBranches();
        await loadTimeline();
        await diffSelected();
        await loadApprovals();
        await loadDrift();
        await loadMigrations();
      })();
    </script>
    <script type="module" src="/laforge-governance.js"></script>
    <script type="module" src="/laforge-audit-integrity.js"></script>
  </body>
</html>`
}

async function ensureGovernanceBundles(): Promise<{ governanceBundlePath: string; auditIntegrityBundlePath: string }> {
  const bundleDir = path.resolve('.laforge', 'studio')
  await fs.mkdir(bundleDir, { recursive: true })
  const entries = [
    {
      entry: path.resolve('packages/cli/studioHarnessClient.tsx'),
      outfile: path.join(bundleDir, 'governance.bundle.js'),
    },
    {
      entry: path.resolve('packages/cli/studioAuditIntegrityClient.tsx'),
      outfile: path.join(bundleDir, 'audit-integrity.bundle.js'),
    },
  ]
  for (const cfg of entries) {
    await fs.writeFile(cfg.outfile, '', 'utf8')
  }
  return {
    governanceBundlePath: entries[0].outfile,
    auditIntegrityBundlePath: entries[1].outfile,
  }
}

async function computeDriftSnapshot(baseDir: string): Promise<DriftSnapshot> {
  const compiledPath = path.join(baseDir, 'generated', 'compiled.json')
  const dbPath = path.join(baseDir, '.laforge', 'db.sqlite')
  try {
    await fs.access(compiledPath)
  } catch {
    return { enabled: false, reason: 'compiled.json not found', compiledPath }
  }
  try {
    await fs.access(dbPath)
  } catch {
    return { enabled: false, reason: 'database not found', dbPath }
  }
  const compiled = JSON.parse(await fs.readFile(compiledPath, 'utf8')) as CompilationOutput
  const db = new DatabaseConnection(dbPath)
  try {
    const drift = await detectDrift(db, compiled)
    return { enabled: true, dbPath, compiledPath, drift }
  } catch (err) {
    return { enabled: false, reason: (err as any)?.message || 'drift computation failed', dbPath, compiledPath }
  } finally {
    db.close()
  }
}

function renderGovernanceHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>LaForge Governance Suite</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      body { margin:0; background:#05060c; color:#e5e7eb; font-family:'Space Grotesk', system-ui, -apple-system, sans-serif; }
      a { color:#00d2ff; }
    </style>
  </head>
  <body>
    <div id="laforge-governance-root"></div>
    <script type="module" src="/laforge-governance.js"></script>
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

