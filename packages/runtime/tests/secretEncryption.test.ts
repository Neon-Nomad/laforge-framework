import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  collectSecretFields,
  decryptSecretFields,
  encryptSecretFields,
  ensureSecretKey,
} from '../dataProtection.js';
import type { ModelDefinition } from '../../compiler/ast/types.js';

describe('Secret field encryption', () => {
  const key = Buffer.alloc(32, 1);
  const keyB64 = key.toString('base64');
  const model: ModelDefinition = {
    name: 'User',
    schema: {
      id: { type: 'uuid', primaryKey: true },
      email: { type: 'string' },
      apiKey: { type: 'string', secret: true },
    },
    relations: [],
    policies: {},
    hooks: [],
    extensions: [],
  };

  beforeEach(() => {
    process.env.LAFORGE_SECRET_KEY = keyB64;
    delete process.env.LAFORGE_KMS_MASTER_KEY;
  });

  afterEach(() => {
    delete process.env.LAFORGE_SECRET_KEY;
    delete process.env.SECRET_KEY;
    delete process.env.LAFORGE_KMS_MASTER_KEY;
  });

  it('collects secret fields', () => {
    expect(collectSecretFields(model)).toEqual(['apiKey']);
  });

  it('encrypts and decrypts secret fields round-trip', () => {
    const secrets = collectSecretFields(model);
    const encrypted = encryptSecretFields({ apiKey: 'supersecret', email: 'a@example.com' }, secrets, key);
    expect(encrypted.apiKey).not.toBe('supersecret');
    expect(typeof encrypted.apiKey).toBe('string');
    const decrypted = decryptSecretFields(encrypted, secrets, key);
    expect(decrypted.apiKey).toBe('supersecret');
    expect(decrypted.email).toBe('a@example.com');
  });

  it('throws when secret key is missing for secret fields', () => {
    delete process.env.LAFORGE_SECRET_KEY;
    expect(() => ensureSecretKey()).toThrow(/LAFORGE_SECRET_KEY/);
  });

  it('supports KMS master key envelope (enc2) format', () => {
    delete process.env.LAFORGE_SECRET_KEY;
    const master = Buffer.alloc(32, 2).toString('base64');
    process.env.LAFORGE_KMS_MASTER_KEY = master;
    const secrets = collectSecretFields(model);
    const encrypted = encryptSecretFields({ apiKey: 'supersecret', email: 'b@example.com' }, secrets);
    expect(String(encrypted.apiKey)).toContain('enc2:');
    const decrypted = decryptSecretFields(encrypted, secrets);
    expect((decrypted as any).apiKey).toBe('supersecret');
    expect((decrypted as any).email).toBe('b@example.com');
  });
});
