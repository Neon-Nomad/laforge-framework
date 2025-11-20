import { describe, expect, it } from 'vitest';
import { compileForSandbox } from '../packages/compiler/index.js';
import { generateRlsPolicies } from '../packages/compiler/rls/astToRls.js';

function compileRls(dsl: string): string {
  const compiled = compileForSandbox(dsl);
  return generateRlsPolicies(compiled.models, { multiTenant: false });
}

describe('RBAC → RLS generation', () => {
  it('emits role, claim, and ABAC predicates per action', () => {
    const rls = compileRls(`
roles { admin editor user }
claims { can.manage.users }

model User { id: uuid pk }
model Post {
  id: uuid pk
  title: string
  authorId: uuid
}

permissions {
  model Post {
    read: admin | can.manage.users if user.id === record.authorId
    create: editor
    delete: admin
  }
}
`);

    expect(rls).toContain("laforge_has_any_role(ARRAY['admin'])");
    expect(rls).toContain("laforge_has_any_claim(ARRAY['can.manage.users'])");
    expect(rls).toContain("CREATE POLICY forge_select_posts ON posts FOR SELECT USING");
    expect(rls).toContain("laforge_user_id() = author_id");
    expect(rls).toContain("CREATE POLICY forge_insert_posts ON posts FOR INSERT WITH CHECK");
    expect(rls).toContain("laforge_has_any_role(ARRAY['editor'])");
    expect(rls).toContain("CREATE POLICY forge_delete_posts ON posts FOR DELETE USING");
  });

  it('supports ABAC-only permissions', () => {
    const rls = compileRls(`
roles { member }

model User { id: uuid pk }
model Note {
  id: uuid pk
  ownerId: uuid
}

permissions {
  model Note {
    update: if user.id == record.ownerId
  }
}
`);

    expect(rls).toContain("laforge_user_id() = owner_id");
    expect(rls).toContain("CREATE POLICY forge_update_notes ON notes FOR UPDATE USING ((TRUE AND (laforge_user_id() = owner_id))) WITH CHECK ((TRUE AND (laforge_user_id() = owner_id)))");
  });
});
