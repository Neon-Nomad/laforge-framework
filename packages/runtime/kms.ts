import crypto from 'node:crypto';

export type KmsConfig =
  | { kms: 'local'; masterKey: string; version?: string }
  | { kms: 'aws'; keyId: string; masterKey?: string; version?: string }
  | { kms: 'azure'; vaultUri: string; keyName: string; masterKey?: string; version?: string }
  | { kms: 'gcp'; keyName: string; masterKey?: string; version?: string }
  | { kms: 'vault'; transitPath: string; keyName: string; masterKey?: string; version?: string };

export interface KmsProvider {
  provider: string;
  version: string;
  encrypt(dataKey: Buffer): Promise<{ wrappedKey: Buffer; version: string }>;
  decrypt(wrappedKey: Buffer): Promise<Buffer>;
  generateDataKey(): Promise<{ dataKey: Buffer; wrappedKey: Buffer; version: string }>;
  health(): Promise<{ ok: boolean; message?: string }>;
}

function assertKeyLength(buf: Buffer, label: string) {
  if (buf.length !== 32) {
    throw new Error(`${label} must be a base64-encoded 32-byte key (AES-256).`);
  }
}

function encryptWithKey(raw: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(raw), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = `${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`;
  return Buffer.from(payload, 'utf8');
}

function decryptWithKey(wrapped: Buffer, key: Buffer): Buffer {
  const [ivB64, dataB64, tagB64] = wrapped.toString('utf8').split(':');
  if (!ivB64 || !dataB64 || !tagB64) throw new Error('Corrupt wrapped payload');
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted;
}

abstract class BaseKms implements KmsProvider {
  provider: string;
  version: string;
  protected masterKey?: Buffer;

  constructor(provider: string, version = 'v1', masterKey?: Buffer) {
    this.provider = provider;
    this.version = version;
    this.masterKey = masterKey;
  }

  protected requireMasterKey(): Buffer {
    if (!this.masterKey) {
      throw new Error(`${this.provider} KMS requires a master key or network implementation.`);
    }
    assertKeyLength(this.masterKey, `${this.provider} master key`);
    return this.masterKey;
  }

  async encrypt(dataKey: Buffer): Promise<{ wrappedKey: Buffer; version: string }> {
    const wrappedKey = encryptWithKey(dataKey, this.requireMasterKey());
    return { wrappedKey, version: this.version };
  }

  async decrypt(wrappedKey: Buffer): Promise<Buffer> {
    return decryptWithKey(wrappedKey, this.requireMasterKey());
  }

  async generateDataKey(): Promise<{ dataKey: Buffer; wrappedKey: Buffer; version: string }> {
    const dataKey = crypto.randomBytes(32);
    const { wrappedKey } = await this.encrypt(dataKey);
    return { dataKey, wrappedKey, version: this.version };
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    try {
      const { wrappedKey } = await this.generateDataKey();
      await this.decrypt(wrappedKey);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, message: err?.message };
    }
  }
}

class LocalKms extends BaseKms {
  constructor(masterKey: Buffer, version = 'v1') {
    super('local', version, masterKey);
  }
}

class StubKms extends BaseKms {
  private fallback?: LocalKms;
  private why: string;

  constructor(provider: string, why: string, fallback?: LocalKms, version = 'v1') {
    super(provider, version, fallback ? (fallback as any).masterKey : undefined);
    this.why = why;
    this.fallback = fallback;
  }

  override async encrypt(dataKey: Buffer): Promise<{ wrappedKey: Buffer; version: string }> {
    if (this.fallback) return this.fallback.encrypt(dataKey);
    throw new Error(`KMS provider "${this.provider}" not implemented: ${this.why}`);
  }

  override async decrypt(wrappedKey: Buffer): Promise<Buffer> {
    if (this.fallback) return this.fallback.decrypt(wrappedKey);
    throw new Error(`KMS provider "${this.provider}" not implemented: ${this.why}`);
  }

  override async generateDataKey(): Promise<{ dataKey: Buffer; wrappedKey: Buffer; version: string }> {
    if (this.fallback) return this.fallback.generateDataKey();
    throw new Error(`KMS provider "${this.provider}" not implemented: ${this.why}`);
  }

  override async health(): Promise<{ ok: boolean; message?: string }> {
    return { ok: !!this.fallback, message: this.fallback ? undefined : this.why };
  }
}

class AwsKmsProvider extends BaseKms {
  constructor(keyId: string, version: string, masterKey?: Buffer) {
    super('aws', version, masterKey);
    this.keyId = keyId;
  }
  keyId: string;
}

class AzureKeyVaultProvider extends BaseKms {
  constructor(vaultUri: string, keyName: string, version: string, masterKey?: Buffer) {
    super('azure', version, masterKey);
    this.vaultUri = vaultUri;
    this.keyName = keyName;
  }
  vaultUri: string;
  keyName: string;
}

class GcpKmsProvider extends BaseKms {
  constructor(keyName: string, version: string, masterKey?: Buffer) {
    super('gcp', version, masterKey);
    this.keyName = keyName;
  }
  keyName: string;
}

class VaultTransitProvider extends BaseKms {
  constructor(transitPath: string, keyName: string, version: string, masterKey?: Buffer) {
    super('vault', version, masterKey);
    this.transitPath = transitPath;
    this.keyName = keyName;
  }
  transitPath: string;
  keyName: string;
}

function parseKmsConfig(): KmsConfig | undefined {
  const raw = process.env.LAFORGE_KMS_CONFIG;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed as KmsConfig;
  } catch (err: any) {
    throw new Error(`Invalid LAFORGE_KMS_CONFIG JSON: ${err?.message || err}`);
  }
}

export function createKmsProvider(config?: KmsConfig): KmsProvider {
  const cfg = config ?? parseKmsConfig();

  if (cfg?.kms === 'local') {
    const key = Buffer.from(cfg.masterKey, 'base64');
    return new LocalKms(key, cfg.version || 'v1');
  }

  const masterKeyFallback =
    (cfg as any)?.masterKey || process.env.LAFORGE_KMS_MASTER_KEY || process.env.LAFORGE_SECRET_KEY;

  if (cfg?.kms === 'aws') {
    const fallbackKey = masterKeyFallback ? Buffer.from(masterKeyFallback, 'base64') : undefined;
    if (fallbackKey) {
      return new AwsKmsProvider(cfg.keyId, cfg.version || 'v1', fallbackKey);
    }
    return new StubKms('aws', 'AWS KMS provider not implemented in OSS; supply masterKey fallback.', undefined, cfg.version || 'v1');
  }

  if (cfg?.kms === 'azure') {
    const fallbackKey = masterKeyFallback ? Buffer.from(masterKeyFallback, 'base64') : undefined;
    if (fallbackKey) {
      return new AzureKeyVaultProvider(cfg.vaultUri, cfg.keyName, cfg.version || 'v1', fallbackKey);
    }
    return new StubKms('azure', 'Azure KMS provider not implemented in OSS; supply masterKey fallback.', undefined, cfg.version || 'v1');
  }

  if (cfg?.kms === 'gcp') {
    const fallbackKey = masterKeyFallback ? Buffer.from(masterKeyFallback, 'base64') : undefined;
    if (fallbackKey) {
      return new GcpKmsProvider(cfg.keyName, cfg.version || 'v1', fallbackKey);
    }
    return new StubKms('gcp', 'GCP KMS provider not implemented in OSS; supply masterKey fallback.', undefined, cfg.version || 'v1');
  }

  if (cfg?.kms === 'vault') {
    const fallbackKey = masterKeyFallback ? Buffer.from(masterKeyFallback, 'base64') : undefined;
    if (fallbackKey) {
      return new VaultTransitProvider(cfg.transitPath, cfg.keyName, cfg.version || 'v1', fallbackKey);
    }
    return new StubKms('vault', 'Vault Transit provider not implemented in OSS; supply masterKey fallback.', undefined, cfg.version || 'v1');
  }

  // Default: use env master key or secret key
  const key =
    process.env.LAFORGE_KMS_MASTER_KEY ||
    process.env.LAFORGE_SECRET_KEY ||
    process.env.SECRET_KEY;
  if (key) {
    return new LocalKms(Buffer.from(key, 'base64'));
  }
  // Ephemeral dev fallback to keep local/test runs working without explicit config.
  const defaultKey = crypto.createHash('sha256').update('laforge-dev-default-key').digest('base64');
  console.warn('[laforge] No KMS config found; using ephemeral dev key (not for production).');
  return new LocalKms(Buffer.from(defaultKey, 'base64'));
}
