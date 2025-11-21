import { describe, expect, it } from 'vitest';
import { validateResidency } from '../dataProtection.js';
import type { ModelDefinition } from '../../compiler/ast/types.js';

describe('Residency enforcement', () => {
  const model: ModelDefinition = {
    name: 'SecretStuff',
    schema: {
      id: { type: 'uuid', primaryKey: true },
      email: { type: 'string', residency: 'eu' } as any,
      name: { type: 'string' },
    },
    relations: [],
    policies: {},
    hooks: [],
    extensions: [],
  };

  it('allows writes when residency matches', () => {
    expect(() => validateResidency(model, { email: 'a@example.eu' }, 'eu')).not.toThrow();
  });

  it('blocks writes when residency does not match', () => {
    expect(() => validateResidency(model, { email: 'a@example.com' }, 'us')).toThrow(
      /requires residency "eu" but runtime residency is "us"/i,
    );
  });

  it('no-op when runtime residency is not set', () => {
    expect(() => validateResidency(model, { email: 'a@example.com' }, undefined)).not.toThrow();
  });
});
