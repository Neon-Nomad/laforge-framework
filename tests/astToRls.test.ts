import { expect, test } from 'vitest';
import { parseForgeDsl } from '../packages/compiler/index.js';
import { generateRlsPolicies } from '../packages/compiler/rls/astToRls.js';
import { compileForSandbox } from '../packages/compiler/index.js';

function compileRls(dsl: string, multiTenant = false): string {
  const compiled = compileForSandbox(dsl);
  return generateRlsPolicies(compiled.models, { multiTenant });
}

test('literal true policies become TRUE', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
}
policy Note.read {
  true
}
`);
  expect(rls).toContain('USING (true)');
});

test('literal false policies become FALSE', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
}
policy Note.read {
  false
}
`);
  expect(rls).toContain('USING (false)');
});

test('simple comparison included in SQL', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
  title: string
}
policy Note.read {
  record.title === "Public Note"
}
`);
  expect(rls).toContain("title = 'Public Note'");
});

test('arrow returning true works', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
}
policy Note.read {
  () => true
}
`);
  expect(rls).toContain('USING (true)');
});

test('arrow with record comparison works', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
  title: string
}
policy Note.read {
  (record) => record.title === "Public Note"
}
`);
  expect(rls).toContain("title = 'Public Note'");
});

test('arrow comparing user and record works', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
  ownerId: uuid
}
policy Note.read {
  ({ record, user }) => record.ownerId === user.id
}
`);
  expect(rls).toContain("owner_id = current_setting('app.user_id')::uuid");
});

test('tenant isolation composes with policy', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
  tenantId: uuid tenant
}
policy Note.read {
  true
}
`, true);
  expect(rls).toContain("(tenant_id = current_setting('app.tenant_id')::uuid) AND (true)");
});

test('invalid bare expression throws', () => {
  expect(() =>
    compileRls(`
model User {
  id: uuid pk
}
policy User.read {
  foo == bar
}
`)
  ).toThrow(/Unknown variable in chain: foo/);
});
