const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sbomPath = path.join(process.cwd(), '.laforge', 'sbom', 'sbom.json');
const tmpPath = path.join(process.cwd(), '.laforge', 'sbom', 'sbom.tmp.json');

function hashFile(file) {
  const data = fs.readFileSync(file);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function run() {
  if (!fs.existsSync(sbomPath)) {
    console.error('SBOM missing; run npm run sbom first');
    process.exit(1);
  }
  // regenerate SBOM and compare hash for reproducibility from lockfile
  const { spawnSync } = require('node:child_process');
  const res = spawnSync('node', [path.join('scripts', 'sbom.cjs')], { stdio: 'inherit', shell: false });
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
  fs.renameSync(sbomPath, tmpPath); // move new sbom to temp for hash comparison
  // regenerate expected to original path
  spawnSync('node', [path.join('scripts', 'sbom.cjs')], { stdio: 'inherit', shell: false });

  const oldHash = hashFile(tmpPath);
  const newHash = hashFile(sbomPath);
  if (oldHash !== newHash) {
    console.error('Repro check failed: SBOM hash changed; lockfile drift or nondeterministic SBOM.');
    console.error(`old hash: ${oldHash}`);
    console.error(`new hash: ${newHash}`);
    process.exit(1);
  }
  fs.unlinkSync(tmpPath);
  console.log('Repro check passed: SBOM deterministic.');
}

run();
