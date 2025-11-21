import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { rotateEnc2Token } from '../lib/kms.js';
import { createKmsProvider } from '../../runtime/kms.js';
import { collectSecretFields, encryptSecretFields, decryptSecretFields } from '../../runtime/dataProtection.js';
import type { ModelDefinition } from '../../compiler/ast/types.js';

describe('kms rotation', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const model: ModelDefinition = {
    name: 'User',
    schema: { id: { type: 'uuid', primaryKey: true }, apiKey: { type: 'string', secret: true } },
    relations: [],
    policies: {},
    hooks: [],
    extensions: [],
  };

  beforeEach(() => {
    process.env.LAFORGE_KMS_MASTER_KEY = key;
  });

  afterEach(() => {
    delete process.env.LAFORGE_KMS_MASTER_KEY;
  });

  it('re-wraps enc2 tokens without touching ciphertext and bumps version', async () => {
    const secrets = collectSecretFields(model);
    const kmsV1 = createKmsProvider({ kms: 'aws', keyId: 'test', masterKey: key, version: 'v1' });
    const encrypted = await encryptSecretFields({ apiKey: 'rotate-me' }, secrets, undefined, kmsV1);
    const token = String((encrypted as any).apiKey);
    expect(token).toMatch(/^enc2:aws:v1:/);

    const kmsV2 = createKmsProvider({ kms: 'aws', keyId: 'test', masterKey: key, version: 'v2' });
    const rotated = await rotateEnc2Token(token, kmsV2, 'v2');
    expect(rotated).toMatch(/^enc2:aws:v2:/);

    // ciphertext (iv/data/tag) stays the same
    const originalParts = token.split(':');
    const rotatedParts = rotated.split(':');
    expect(rotatedParts.slice(-3).join(':')).toBe(originalParts.slice(-3).join(':'));

    const decrypted = await decryptSecretFields({ apiKey: rotated }, secrets, undefined, kmsV2);
    expect((decrypted as any).apiKey).toBe('rotate-me');
  });
});
