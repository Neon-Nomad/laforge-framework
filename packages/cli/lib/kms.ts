import { createKmsProvider, type KmsProvider } from '../../runtime/kms.js';

interface ParsedEnc2 {
  provider: string;
  version: string;
  wrappedKey: Buffer;
  iv: string;
  data: string;
  tag: string;
}

function parseEnc2(token: string): ParsedEnc2 {
  if (!token.startsWith('enc2:')) {
    throw new Error('Only enc2 tokens are supported for rotation.');
  }
  const parts = token.split(':');
  if (parts.length >= 7) {
    const [, provider, version, wrappedKeyB64, iv, data, tag] = parts;
    return { provider, version, wrappedKey: Buffer.from(wrappedKeyB64, 'base64'), iv, data, tag };
  }
  if (parts.length >= 6) {
    // legacy enc2:<wrapped>:<iv>:<data>:<tag>:<provider>
    const [, wrappedKeyB64, iv, data, tag, provider] = parts;
    return { provider, version: 'v1', wrappedKey: Buffer.from(wrappedKeyB64, 'base64'), iv, data, tag };
  }
  throw new Error('Corrupt enc2 token; missing segments.');
}

export async function rotateEnc2Token(token: string, provider?: KmsProvider, targetVersion?: string): Promise<string> {
  const parsed = parseEnc2(token);
  const kms = provider ?? createKmsProvider();
  if (parsed.provider && parsed.provider !== kms.provider) {
    throw new Error(`KMS provider mismatch: token=${parsed.provider}, runtime=${kms.provider}`);
  }
  const dataKey = await kms.decrypt(parsed.wrappedKey);
  const { wrappedKey, version } = await kms.encrypt(dataKey);
  const newVersion = targetVersion || version || kms.version || parsed.version;
  return `enc2:${kms.provider}:${newVersion}:${wrappedKey.toString('base64')}:${parsed.iv}:${parsed.data}:${parsed.tag}`;
}

export async function rotateEnc2Tokens(tokens: string[], provider?: KmsProvider, targetVersion?: string): Promise<string[]> {
  return Promise.all(tokens.map(t => rotateEnc2Token(t, provider, targetVersion)));
}

export function makeKmsProviderFromConfig(opts: { provider?: string; version?: string; keyId?: string; keyName?: string }) {
  if (!opts.provider) return createKmsProvider();
  const kms = opts.provider;
  const envKey = process.env.LAFORGE_KMS_MASTER_KEY || process.env.LAFORGE_SECRET_KEY || process.env.SECRET_KEY;
  if (kms === 'aws') return createKmsProvider({ kms: 'aws', keyId: opts.keyId || 'laforge', masterKey: envKey, version: opts.version });
  if (kms === 'azure') return createKmsProvider({ kms: 'azure', vaultUri: 'local', keyName: opts.keyName || 'laforge', masterKey: envKey, version: opts.version });
  if (kms === 'gcp') return createKmsProvider({ kms: 'gcp', keyName: opts.keyName || 'projects/x/locations/y/keyRings/z/cryptoKeys/laforge', masterKey: envKey, version: opts.version });
  if (kms === 'vault') return createKmsProvider({ kms: 'vault', transitPath: 'transit', keyName: opts.keyName || 'laforge', masterKey: envKey, version: opts.version });
  if (kms === 'local') {
    if (!envKey) return createKmsProvider();
    return createKmsProvider({ kms: 'local', masterKey: envKey, version: opts.version });
  }
  return createKmsProvider();
}
