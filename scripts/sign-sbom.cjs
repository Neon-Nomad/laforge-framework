const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const baseDir = process.cwd();
const sbomPath = path.join(baseDir, '.laforge', 'sbom', 'sbom.json');
const sigPath = path.join(baseDir, '.laforge', 'sbom', 'sbom.sig');
const keyDir = path.join(baseDir, '.laforge', 'keys');
const privKeyPath = path.join(keyDir, 'ed25519_private.pem');
const pubKeyPath = path.join(keyDir, 'ed25519_public.pem');

function main() {
  if (!fs.existsSync(sbomPath)) {
    console.error('SBOM not found; run npm run sbom first');
    process.exit(1);
  }
  if (!fs.existsSync(privKeyPath)) {
    console.error('Private key missing at ' + privKeyPath);
    process.exit(1);
  }
  const data = fs.readFileSync(sbomPath);
  const priv = crypto.createPrivateKey(fs.readFileSync(privKeyPath));
  const signature = crypto.sign(null, data, priv).toString('base64');
  let publicKey;
  if (fs.existsSync(pubKeyPath)) {
    publicKey = fs.readFileSync(pubKeyPath, 'utf8');
  } else {
    publicKey = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString();
  }
  fs.writeFileSync(sigPath, JSON.stringify({ signature, publicKey }, null, 2));
  console.log('SBOM signed -> ' + sigPath);
}

main();
