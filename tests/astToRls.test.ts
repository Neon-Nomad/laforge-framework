import { expect, test } from 'vitest';
import { generateRlsPolicies } from '../compiler/rls/astToRls.js';
import { compileForSandbox } from '../compiler/index.js';

function compileRls(dsl: string, multiTenant = false): string {
  const compiled = compileForSandbox(dsl);
  return generateRlsPolicies(compiled.models, { multiTenant });
}

test('literal true policies become TRUE', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
  text: string
}

policy Note.read {
  true
}
`);
  expect(rls).toContain('USING (TRUE)');
});

test('literal false policies become FALSE', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
  text: string
}

policy Note.read {
  false
}
`);
  expect(rls).toContain('USING (FALSE)');
});

test('simple comparison included in SQL', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
  text: string
}

policy Note.read {
  record.text == "hello"
}
`);
  expect(rls).toContain("USING (text = 'hello')");
});

test('arrow returning true works', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
  text: string
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
  text: string
}

policy Note.read {
  (record) => record.text === "abc"
}
`);
  expect(rls).toContain("USING (text = 'abc')");
});

test('arrow comparing user and record works', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
  text: string
}

policy Note.read {
  ({ user, record }) => user.id === record.id
}
`);
  expect(rls).toContain("USING (current_setting('app.user_id')::uuid = id)");
});

test('tenant isolation composes with policy', () => {
  const rls = compileRls(`
model Note {
  id: uuid pk
  tenantId: uuid tenant
  text: string
}

policy Note.read {
  true
}
`, true);
  expect(rls).toContain('(tenant_id = current_setting(\'app.tenant_id\')::uuid) AND (TRUE)');
});

test('invalid bare expression throws', () => {
  expect(() =>
    compileForSandbox(`
model Note {
  id: uuid pk
  text: string
}

policy Note.read {
  foo == bar
}
`)
  ).toThrow(/Could not find a valid expression in the policy handler: foo == bar/);
});
