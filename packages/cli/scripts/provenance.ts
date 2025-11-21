import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { CompilationOutput } from '../../compiler/index.js';

async function main() {
  const baseDir = process.cwd();
  const compiledPath = path.join(baseDir, 'generated', 'compiled.json');
  const provPath = path.join(baseDir, '.laforge', 'provenance.json');

  let compiled: CompilationOutput;
  try {
    compiled = JSON.parse(await fs.readFile(compiledPath, 'utf8')) as CompilationOutput;
  } catch (err: any) {
    console.error(`Failed to read compiled output at ${compiledPath}: ${err.message}`);
    process.exit(1);
    return;
  }

  await fs.mkdir(path.dirname(provPath), { recursive: true });
  const compiledHash = crypto.createHash('sha256').update(JSON.stringify(compiled)).digest('hex');
  const provenance = {
    createdAt: new Date().toISOString(),
    compiledPath,
    compiledHash,
  };
  await fs.writeFile(provPath, JSON.stringify(provenance, null, 2), 'utf8');
  console.log(`Provenance written to ${provPath}`);
}

main();
