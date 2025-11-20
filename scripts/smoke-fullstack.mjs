#!/usr/bin/env node
import { rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
const nodeExec = process.env.npm_node_execpath || process.execPath;
const npmFallback = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runNpm(args, options = {}) {
  if (npmCli) {
    execFileSync(nodeExec, [npmCli, ...args], { stdio: 'inherit', cwd: root, ...options });
  } else {
    execFileSync(npmFallback, args, { stdio: 'inherit', cwd: root, ...options });
  }
}

function cleanDir(relPath) {
  const target = path.isAbsolute(relPath) ? relPath : path.join(root, relPath);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
}

console.log('📦 Installing dependencies');
runNpm(['install']);

console.log('🛠️  Building CLI');
runNpm(['run', 'build']);

console.log('🧹 Cleaning previous generated artifacts');
cleanDir(path.join('examples', 'simple-blog', 'generated'));
cleanDir(path.join('examples', 'simple-blog', 'generated_frontend'));

console.log('🚀 Running forge generate (simple-blog)');
runNpm(['run', 'forge', '--', 'generate', 'examples/simple-blog/domain.ts']);

const frontendDir = path.join(root, 'examples', 'simple-blog', 'generated_frontend', 'frontend');
console.log('📦 Installing generated frontend dependencies');
runNpm(['install'], { cwd: frontendDir });

console.log('🏗️  Building generated frontend');
runNpm(['run', 'build'], { cwd: frontendDir });

console.log('\n✅ Smoke test complete! Generated backend + frontend are ready.\n');

console.log('🧼 Cleaning smoke outputs');
cleanDir(path.join('examples', 'simple-blog', 'generated'));
cleanDir(path.join('examples', 'simple-blog', 'generated_frontend'));
