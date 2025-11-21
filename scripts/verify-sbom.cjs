const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const baseDir = process.cwd();
const sbomPath = path.join(baseDir, '.laforge', 'sbom', 'sbom.json');
const lockPath = path.join(baseDir, 'package-lock.json');

function hashLock() {
  if (!fs.existsSync(lockPath)) {
    console.error('package-lock.json missing');
    process.exit(1);
  }
  return crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');
}

function main() {
  if (!fs.existsSync(sbomPath)) {
    console.error('SBOM missing; run npm run sbom first');
    process.exit(1);
  }
  const sbom = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
  const currentLockHash = hashLock();
  if (!sbom.lockHash) {
    console.error('SBOM missing lockHash field; regenerate via npm run sbom');
    process.exit(1);
  }
  if (sbom.lockHash !== currentLockHash) {
    console.error('SBOM lockHash does not match current package-lock.json');
    console.error(`sbom.lockHash: ${sbom.lockHash}`);
    console.error(`current:     ${currentLockHash}`);
    process.exit(1);
  }
  console.log('SBOM verified against package-lock.json');
}

main();
