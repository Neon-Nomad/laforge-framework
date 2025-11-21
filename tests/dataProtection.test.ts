import { describe, expect, it } from 'vitest';
import { compileForSandbox } from '../packages/compiler/index.js';

describe('Data protection annotations', () => {
  it('carries pii/secret/residency flags from DSL into the compiled schema', () => {
    const dsl = `
model User {
  id: uuid pk
  email: string pii
  ssn: string pii residency(us-east)
  apiKey: string secret optional
  notes: text
}
`;
    const compiled = compileForSandbox(dsl);
    const user = compiled.models.find(m => m.name === 'User');
    expect(user).toBeTruthy();
    const schema = user?.schema as any;
    expect(schema.email.pii).toBe(true);
    expect(schema.ssn.pii).toBe(true);
    expect(schema.ssn.residency).toBe('us-east');
    expect(schema.apiKey.secret).toBe(true);
    expect(schema.apiKey.optional).toBe(true);
    expect(schema.notes.pii).toBeUndefined();
  });
});
