const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const baseDir = process.cwd();
const lockPath = path.join(baseDir, 'package-lock.json');
const outDir = path.join(baseDir, '.laforge', 'sbom');
const outFile = path.join(outDir, 'sbom.json');

function stableTimestamp() {
  try {
    const stat = fs.statSync(lockPath);
    return stat.mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function main() {
  if (!fs.existsSync(lockPath)) {
    console.error('package-lock.json not found');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const deps = lock.packages || {};
  const entries = Object.entries(deps).map(([name, info]) => ({
    name: name || '.',
    version: info.version || '',
    license: info.license || info.licenses || undefined,
    resolved: info.resolved,
    integrity: info.integrity,
  }));
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const lockHash = crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');
  const sbom = {
    createdAt: stableTimestamp(),
    type: 'laforge-sbom',
    root: lock.name || 'laforge',
    lockVersion: lock.lockfileVersion,
    lockHash,
    packages: entries,
  };
  fs.writeFileSync(outFile, JSON.stringify(sbom, null, 2));
  console.log(`SBOM written to ${outFile}`);
}

main();
