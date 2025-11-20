import { describe, expect, it } from 'vitest';
import { parseForgeDsl } from '../packages/compiler/index.js';

describe('RBAC DSL extensions', () => {
  it('parses roles, claims, and permissions with ABAC conditions', () => {
    const models = parseForgeDsl(`
roles {
  admin
  editor
  user
}

claims {
  can.manage.users
  can.view.private
  admin: can.manage.users | can.view.private
}

model User {
  id: uuid pk
  name: string
}

model Post {
  id: uuid pk
  title: string
  author: belongsTo(User)
}

permissions {
  model Post {
    create: admin | editor
    read: user | can.view.private
    update: editor if user.id === record.authorId
    delete: admin | can.manage.users
  }
}
`);

    const post = models.find(m => m.name === 'Post');
    expect(post?.roles).toEqual(expect.arrayContaining(['admin', 'editor', 'user']));
    expect(post?.claims).toEqual(expect.arrayContaining(['can.manage.users', 'can.view.private']));
    expect(post?.roleClaims?.admin).toEqual(expect.arrayContaining(['can.manage.users', 'can.view.private']));

    const perms = post?.permissions;
    expect(perms?.create?.roles).toEqual(['admin', 'editor']);
    expect(perms?.read?.roles).toEqual(['user']);
    expect(perms?.read?.claims).toEqual(['can.view.private']);
    expect(perms?.update?.roles).toEqual(['editor']);
    expect(perms?.update?.condition).toBe('user.id === record.authorId');
    expect(perms?.delete?.claims).toEqual(['can.manage.users']);
  });

  it('errors on unknown roles or claims in permissions', () => {
    expect(() =>
      parseForgeDsl(`
roles { admin }
claims { can.manage.users }
model Post { id: uuid pk }
permissions { model Post { create: editor } }
`),
    ).toThrow(/unknown role "editor"/i);

    expect(() =>
      parseForgeDsl(`
roles { admin }
claims { can.manage.users }
model Post { id: uuid pk }
permissions { model Post { delete: can.edit.all } }
`),
    ).toThrow(/unknown claim "can\.edit\.all"/i);
  });

  it('errors when permissions target an unknown model', () => {
    expect(() =>
      parseForgeDsl(`
roles { admin }
claims { can.manage.users }
model Post { id: uuid pk }
permissions { model Missing { create: admin } }
`),
    ).toThrow(/unknown model "Missing"/i);
  });
});
