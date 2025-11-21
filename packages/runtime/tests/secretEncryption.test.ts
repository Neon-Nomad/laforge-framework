import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  collectSecretFields,
  decryptSecretFields,
  encryptSecretFields,
  ensureSecretKey,
} from '../dataProtection.js';
import type { ModelDefinition } from '../../compiler/ast/types.js';
import { AuditLogger } from '../audit.js';

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

  it('encrypts and decrypts secret fields round-trip', async () => {
    const secrets = collectSecretFields(model);
    const encrypted = await encryptSecretFields({ apiKey: 'supersecret', email: 'a@example.com' }, secrets, key);
    expect(encrypted.apiKey).not.toBe('supersecret');
    expect(typeof encrypted.apiKey).toBe('string');
    const decrypted = await decryptSecretFields(encrypted, secrets, key);
    expect(decrypted.apiKey).toBe('supersecret');
    expect(decrypted.email).toBe('a@example.com');
  });

  it('throws when secret key is missing for secret fields', () => {
    delete process.env.LAFORGE_SECRET_KEY;
    expect(() => ensureSecretKey()).toThrow(/LAFORGE_SECRET_KEY/);
  });

  it('supports KMS master key envelope (enc2) format', async () => {
    delete process.env.LAFORGE_SECRET_KEY;
    const master = Buffer.alloc(32, 2).toString('base64');
    process.env.LAFORGE_KMS_MASTER_KEY = master;
    const secrets = collectSecretFields(model);
    const encrypted = await encryptSecretFields({ apiKey: 'supersecret', email: 'b@example.com' }, secrets);
    expect(String(encrypted.apiKey)).toMatch(/^enc2:local:/);
    const decrypted = await decryptSecretFields(encrypted, secrets);
    expect((decrypted as any).apiKey).toBe('supersecret');
    expect((decrypted as any).email).toBe('b@example.com');
  });

  it('records audit entries when decrypting', async () => {
    const secrets = collectSecretFields(model);
    const audit = new AuditLogger();
    const encrypted = await encryptSecretFields({ apiKey: 'supersecret', email: 'a@example.com' }, secrets, key);
    await decryptSecretFields(encrypted, secrets, key, undefined, {
      audit,
      modelName: 'User',
      userId: 'u1',
      tenantId: 't1',
      purpose: 'test',
    });
    const entry = audit.getLogs().find(evt => evt.type === 'decrypt');
    expect(entry).toBeTruthy();
    expect(entry?.data).toMatchObject({ field: 'apiKey', kms: 'local', keyVersion: 'v1', purpose: 'test' });
  });

  it('adds guard, residency, and ABAC context to decrypt audits', async () => {
    const secrets = collectSecretFields(model);
    const audit = new AuditLogger();
    const encrypted = await encryptSecretFields({ apiKey: 'supersecret', email: 'a@example.com' }, secrets, key);
    await decryptSecretFields(encrypted, secrets, key, undefined, {
      audit,
      modelName: 'User',
      userId: 'u2',
      tenantId: 't2',
      purpose: 'test-abac',
      guardPath: 'User.read',
      residency: { enforced: 'us', violated: false, source: 'test' },
      abac: {
        result: 'allow',
        reason: 'User matched ABAC rule',
        expression: 'user.id == record.ownerId',
        trace: [{ rule: 'User.read', result: 'allow', detail: 'author or admin' }],
      },
    });
    const entry = audit.getLogs().find(evt => evt.type === 'decrypt');
    expect(entry?.data).toMatchObject({
      field: 'apiKey',
      kms: 'local',
      keyVersion: 'v1',
      guardPath: 'User.read',
      residency: { enforced: 'us', violated: false, source: 'test' },
      abac: expect.objectContaining({
        result: 'allow',
        reason: 'User matched ABAC rule',
      }),
    });
    expect((entry?.data as any)?.abac?.trace?.[0]).toMatchObject({ rule: 'User.read', result: 'allow' });
  });
});
