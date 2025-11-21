const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const baseDir = process.cwd();
const sbomPath = path.join(baseDir, '.laforge', 'sbom', 'sbom.json');
const sigPath = path.join(baseDir, '.laforge', 'sbom', 'sbom.sig');

function main() {
  if (!fs.existsSync(sbomPath) || !fs.existsSync(sigPath)) {
    console.error('SBOM or signature missing. Run npm run sbom && npm run sign:sbom');
    process.exit(1);
  }
  const sbom = fs.readFileSync(sbomPath);
  const sigData = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
  if (!sigData.signature || !sigData.publicKey) {
    console.error('Signature file missing fields.');
    process.exit(1);
  }
  const ok = crypto.verify(null, sbom, crypto.createPublicKey(sigData.publicKey), Buffer.from(sigData.signature, 'base64'));
  if (!ok) {
    console.error('SBOM signature verification failed');
    process.exit(1);
  }
  console.log('SBOM signature verified');
}

main();
