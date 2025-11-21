import crypto from 'node:crypto';
import type { ModelDefinition, FieldOptions } from '../compiler/ast/types.js';

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

export function ensureMasterKey(): Buffer | null {
  const key = process.env.LAFORGE_KMS_MASTER_KEY;
  if (!key) return null;
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) {
    throw new Error('LAFORGE_KMS_MASTER_KEY must be a base64-encoded 32-byte key (AES-256).');
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

export function encryptSecretFields<T extends Record<string, any>>(payload: T, secretFields: string[], directKey?: Buffer): T {
  if (!secretFields.length) return payload;
  const masterKey = ensureMasterKey();
  const clone: any = { ...payload };
  for (const field of secretFields) {
    if (clone[field] === undefined || clone[field] === null) continue;
    const dataKey = masterKey ? crypto.randomBytes(32) : directKey;
    if (!dataKey) {
      throw new Error('Secret encryption requires LAFORGE_SECRET_KEY or LAFORGE_KMS_MASTER_KEY.');
    }
    const wrappedKey = masterKey ? Buffer.from(wrapDataKey(dataKey, masterKey)).toString('base64') : null;
    const { iv, data, tag } = encryptValue(clone[field], dataKey);
    clone[field] = masterKey ? `enc2:${wrappedKey}:${iv}:${data}:${tag}` : `enc:${iv}:${data}:${tag}`;
  }
  return clone;
}

export function decryptSecretFields<T>(payload: T, secretFields: string[], directKey?: Buffer): T {
  if (!secretFields.length || payload === null || payload === undefined) return payload;
  if (Array.isArray(payload)) {
    return payload.map(item => decryptSecretFields(item, secretFields, directKey)) as any;
  }
  if (typeof payload !== 'object') return payload;
  const masterKey = ensureMasterKey();
  const clone: any = { ...(payload as any) };
  for (const field of secretFields) {
    const val = (clone as any)[field];
    if (typeof val === 'string' && val.startsWith('enc2:')) {
      if (!masterKey) {
        throw new Error('LAFORGE_KMS_MASTER_KEY is required to decrypt secret fields.');
      }
      const [, wrappedB64, ivB64, dataB64, tagB64] = val.split(':');
      const wrapped = Buffer.from(wrappedB64, 'base64').toString('utf8');
      const dataKey = unwrapDataKey(wrapped, masterKey);
      const token = `enc:${ivB64}:${dataB64}:${tagB64}`;
      clone[field] = decryptValue(token, dataKey);
    } else if (typeof val === 'string' && val.startsWith('enc:')) {
      if (!directKey) {
        throw new Error('LAFORGE_SECRET_KEY is required to decrypt legacy secret fields.');
      }
      clone[field] = decryptValue(val, directKey);
    }
  }
  return clone;
}
