import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { CompilationOutput } from '../../compiler/index.js';

export interface ProvenanceRecord {
  compiledPath?: string;
  compiledHash?: string;
  createdAt?: string;
}

export interface ProvenanceVerification {
  ok: boolean;
  provenancePath: string;
  compiledPath: string;
  expectedHash?: string;
  actualHash?: string;
  reason?: string;
}

async function readJson<T>(filePath: string): Promise<T> {
  const body = await fs.readFile(filePath, 'utf8');
  return JSON.parse(body) as T;
}

function hashCompiled(compiled: CompilationOutput): string {
  return crypto.createHash('sha256').update(JSON.stringify(compiled)).digest('hex');
}

export async function verifyProvenance(options: {
  baseDir?: string;
  provenancePath?: string;
  compiledPath?: string;
} = {}): Promise<ProvenanceVerification> {
  const baseDir = options.baseDir || process.cwd();
  const provenancePath = options.provenancePath || path.join(baseDir, '.laforge', 'provenance.json');

  try {
    const prov = await readJson<ProvenanceRecord>(provenancePath);
    const compiledPath = options.compiledPath || prov.compiledPath || path.join(baseDir, 'generated', 'compiled.json');

    if (!prov.compiledHash) {
      return { ok: false, provenancePath, compiledPath, reason: 'compiledHash missing in provenance.json' };
    }

    let compiled: CompilationOutput;
    try {
      compiled = await readJson<CompilationOutput>(compiledPath);
    } catch (err: any) {
      return { ok: false, provenancePath, compiledPath, expectedHash: prov.compiledHash, reason: err.message };
    }

    const actualHash = hashCompiled(compiled);
    const ok = actualHash === prov.compiledHash;
    return {
      ok,
      provenancePath,
      compiledPath,
      expectedHash: prov.compiledHash,
      actualHash,
      reason: ok ? undefined : 'Hash mismatch',
    };
  } catch (err: any) {
    return {
      ok: false,
      provenancePath,
      compiledPath: options.compiledPath || path.join(baseDir, 'generated', 'compiled.json'),
      reason: err.message,
    };
  }
}
