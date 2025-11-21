import crypto from 'node:crypto';
import type { ModelDefinition, FieldOptions } from '../compiler/ast/types.js';
import type { KmsProvider } from './kms.js';
import { createKmsProvider } from './kms.js';
import type { AuditLogger } from './audit.js';

const isRelation = (value: any) => value && typeof value === 'object' && value.__typeName === 'Relation';

export function collectMaskedFields(models: ModelDefinition[]): string[] {
  const fields: string[] = [];
  models.forEach(model => {
    Object.entries(model.schema).forEach(([fieldName, definition]) => {
      if (isRelation(definition)) return;
      if (typeof definition === 'object' && ((definition as FieldOptions).pii || (definition as FieldOptions).secret)) {
        fields.push(fieldName);
      }
    });
  });
  return fields;
}

export function collectSecretFields(model: ModelDefinition): string[] {
  const fields: string[] = [];
  Object.entries(model.schema).forEach(([fieldName, definition]) => {
    if (isRelation(definition)) return;
    if (typeof definition === 'object' && (definition as FieldOptions).secret) {
      fields.push(fieldName);
    }
  });
  return fields;
}

export function validateResidency(model: ModelDefinition, data: any, enforcedResidency?: string) {
  if (!enforcedResidency) return;
  const entries = Object.entries(model.schema);
  for (const [fieldName, definition] of entries) {
    if (isRelation(definition)) continue;
    const opts = typeof definition === 'object' ? (definition as FieldOptions) : undefined;
    if (!opts?.residency) continue;
    if (opts.residency !== enforcedResidency && data && Object.prototype.hasOwnProperty.call(data, fieldName)) {
      throw new Error(
        `Field "${model.name}.${fieldName}" requires residency "${opts.residency}" but runtime residency is "${enforcedResidency}".`,
      );
    }
  }
}

export function ensureSecretKey(): Buffer {
  const key = process.env.LAFORGE_SECRET_KEY || process.env.SECRET_KEY;
  if (!key) {
    throw new Error('Secret fields require LAFORGE_SECRET_KEY (base64, 32 bytes) to be configured.');
  }
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) {
    throw new Error('LAFORGE_SECRET_KEY must be a base64-encoded 32-byte key (AES-256).');
  }
  return buf;
}

function encryptValue(raw: unknown, key: Buffer): { iv: string; data: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), data: encrypted.toString('base64'), tag: tag.toString('base64') };
}

function decryptValue(token: string, key: Buffer): string {
  if (!token.startsWith('enc:')) return token;
  const [, ivB64, dataB64, tagB64] = token.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString();
  return decrypted;
}

function wrapDataKey(dataKey: Buffer, masterKey: Buffer): string {
  const { iv, data, tag } = encryptValue(dataKey, masterKey);
  return `${iv}:${data}:${tag}`;
}

function unwrapDataKey(wrapped: string, masterKey: Buffer): Buffer {
  const [ivB64, dataB64, tagB64] = (wrapped || '').split(':');
  if (!ivB64 || !dataB64 || !tagB64) {
    throw new Error('Corrupt wrapped data key');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted;
}

export async function encryptSecretFields<T extends Record<string, any>>(payload: T, secretFields: string[], directKey?: Buffer, kms?: KmsProvider): Promise<T> {
  if (!secretFields.length) return payload;
  const provider = kms || createKmsProvider();
  const clone: any = { ...payload };
  for (const field of secretFields) {
    if (clone[field] === undefined || clone[field] === null) continue;
    const directDataKey = directKey || undefined;
    const { dataKey: generatedKey, wrappedKey, version: keyVersion } = directDataKey
      ? { dataKey: directDataKey, wrappedKey: Buffer.from(''), version: provider.version }
      : await provider.generateDataKey();
    const keyToUse = directDataKey ?? generatedKey;
    const wrapped = wrappedKey?.length ? wrappedKey : (await provider.encrypt(keyToUse)).wrappedKey;
    const { iv, data, tag } = encryptValue(clone[field], keyToUse);
    const wrappedB64 = wrapped.toString('base64');
    const version = keyVersion || provider.version || 'v1';
    clone[field] = `enc2:${provider.provider}:${version}:${wrappedB64}:${iv}:${data}:${tag}`;
  }
  return clone;
}

export interface AbacTrace {
  rule: string;
  result: 'allow' | 'deny' | 'unknown';
  detail?: string;
}

export interface DecryptAuditOptions {
  audit?: AuditLogger;
  modelName?: string;
  userId?: string;
  tenantId?: string;
  requestId?: string;
  purpose?: string;
  guardPath?: string;
  residency?: { enforced?: string | null; violated?: boolean; source?: string | null };
  abac?: { result?: 'allow' | 'deny' | 'unknown'; reason?: string; expression?: string; trace?: AbacTrace[] };
}

export async function decryptSecretFields<T>(
  payload: T,
  secretFields: string[],
  directKey?: Buffer,
  kms?: KmsProvider,
  auditOptions?: DecryptAuditOptions,
): Promise<T> {
  if (!secretFields.length || payload === null || payload === undefined) return payload;
  if (Array.isArray(payload)) {
    const results = await Promise.all(
      payload.map(item => decryptSecretFields(item, secretFields, directKey, kms, auditOptions)),
    );
    return results as any;
  }
  if (typeof payload !== 'object') return payload;
  const provider = kms || createKmsProvider();
  const clone: any = { ...(payload as any) };
  for (const field of secretFields) {
    const val = (clone as any)[field];
    if (typeof val === 'string' && val.startsWith('enc2:')) {
      const parts = val.split(':');
      let kmsName = provider.provider;
      let keyVersion = provider.version || 'v1';
      let wrappedKeyB64: string | undefined;
      let ivB64: string | undefined;
      let dataB64: string | undefined;
      let tagB64: string | undefined;
      if (parts.length >= 7) {
        [, kmsName, keyVersion, wrappedKeyB64, ivB64, dataB64, tagB64] = parts;
      } else {
        // Legacy enc2:<wrapped>:<iv>:<data>:<tag>:<provider>
        [, wrappedKeyB64, ivB64, dataB64, tagB64, kmsName] = parts;
        keyVersion = keyVersion || 'v1';
      }
      if (kmsName && kmsName !== provider.provider) {
        if (auditOptions?.audit) {
          auditOptions.audit.record('pii_reveal_denied', {
            userId: auditOptions.userId,
            tenantId: auditOptions.tenantId,
            model: auditOptions.modelName,
            requestId: auditOptions.requestId,
            data: { field, reason: 'provider_mismatch', expected: provider.provider, actual: kmsName },
          });
        }
        throw new Error(`KMS provider mismatch: expected ${provider.provider}, got ${kmsName}`);
      }
      if (!wrappedKeyB64 || !ivB64 || !dataB64 || !tagB64) {
        throw new Error('Corrupt enc2 token; missing segments');
      }
      const dataKey = await provider.decrypt(Buffer.from(wrappedKeyB64, 'base64'));
      const token = `enc:${ivB64}:${dataB64}:${tagB64}`;
      const abacTrace =
        auditOptions?.abac?.trace ||
        (auditOptions?.guardPath
          ? [
              {
                rule: auditOptions.guardPath,
                result: (auditOptions.abac?.result || 'allow') as AbacTrace['result'],
                detail: auditOptions.abac?.reason || 'Guard passed before decrypt',
              },
            ]
          : undefined);
      const abacReasoning =
        auditOptions?.abac ||
        ({
          result: 'allow',
          reason: auditOptions?.guardPath
            ? `Guard ${auditOptions.guardPath} passed before decrypt`
            : 'Guard passed before decrypt',
          trace: abacTrace,
        } as const);
      const residencyOutcome = auditOptions?.residency || { enforced: null, violated: false, source: 'runtime' };
      clone[field] = decryptValue(token, dataKey);
      if (auditOptions?.audit) {
        auditOptions.audit.record('decrypt', {
          userId: auditOptions.userId,
          tenantId: auditOptions.tenantId,
          model: auditOptions.modelName,
          requestId: auditOptions.requestId,
          data: {
            field,
            kms: provider.provider,
            keyVersion,
            purpose: auditOptions.purpose || 'secret field read',
            guardPath: auditOptions.guardPath,
            residency: residencyOutcome,
            abac: abacReasoning,
          },
        });
      }
    } else if (typeof val === 'string' && val.startsWith('enc:')) {
      if (!directKey) {
        if (auditOptions?.audit) {
          auditOptions.audit.record('pii_reveal_denied', {
            userId: auditOptions.userId,
            tenantId: auditOptions.tenantId,
            model: auditOptions.modelName,
            requestId: auditOptions.requestId,
            data: { field, reason: 'missing_secret_key' },
          });
        }
        throw new Error('LAFORGE_SECRET_KEY is required to decrypt legacy secret fields.');
      }
      clone[field] = decryptValue(val, directKey);
    }
  }
  return clone;
}
