import { describe, expect, it } from 'vitest';
import { compileForSandbox } from '../packages/compiler/index.js';

const dsl = `
model Post {
  id: uuid pk
  title: string
}
`;

describe('service tracing hooks', () => {
  it('injects runWithTrace wrappers into generated domain services', () => {
    const compiled = compileForSandbox(dsl);
    expect(compiled.domain).toContain('runWithTrace');
    expect(compiled.domain).toContain('service.Post.create');
    expect(compiled.domain).toContain('service.Post.read');
    expect(compiled.domain).toContain('service.Post.update');
    expect(compiled.domain).toContain('service.Post.delete');
  });
});
