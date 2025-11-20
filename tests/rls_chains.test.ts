import { expect, test } from 'vitest';
import { generateRlsPolicies } from '../packages/compiler/rls/astToRls.js';
import { compileForSandbox } from '../packages/compiler/index.js';

function compileRls(dsl: string, multiTenant = false): string {
  const compiled = compileForSandbox(dsl);
  return generateRlsPolicies(compiled.models, { multiTenant });
}

test('1-hop relation chain: record.team.id', () => {
  const rls = compileRls(`
model Team {
  id: uuid pk
}
model User {
  id: uuid pk
  teamId: uuid
  team: belongsTo(Team)
}
policy User.read {
  record.team.id === user.id
}
`);
  // (SELECT j0.id FROM public.teams j0 WHERE j0.id = team_id) = laforge_user_id()
  expect(rls).toContain(`(SELECT j0.id FROM public.teams j0 WHERE j0.id = team_id) = laforge_user_id()`);
});

test('1-hop relation chain with non-FK field: record.team.name', () => {
  const rls = compileRls(`
  model Team {
    id: uuid pk
    name: string
  }
  model User {
    id: uuid pk
    teamId: uuid
    team: belongsTo(Team)
  }
  policy User.read {
    record.team.name === "Engineering"
  }
  `);
  // Scalar subquery for value access
  expect(rls).toContain(`(SELECT j0.name FROM public.teams j0 WHERE j0.id = team_id) = 'Engineering'`);
});

test('2-hop relation chain: record.team.owner.id', () => {
  const rls = compileRls(`
model User {
  id: uuid pk
}
model Team {
  id: uuid pk
  ownerId: uuid
  owner: belongsTo(User)
}
model Project {
  id: uuid pk
  teamId: uuid
  team: belongsTo(Team)
}
policy Project.read {
  record.team.owner.id === user.id
}
`);
  // j0 = Team, j1 = User
  expect(rls).toContain(`(SELECT j1.id FROM public.teams j0 JOIN public.users j1 ON j1.id = j0.owner_id WHERE j0.id = team_id) = laforge_user_id()`);
});

test('Collection predicate: .some()', () => {
  const rls = compileRls(`
model User {
  id: uuid pk
}
model Comment {
    id: uuid pk
    postId: uuid
}
model Post {
    id: uuid pk
    comments: hasMany(Comment)
}

policy Post.read {
    record.comments.some(c => c.id === user.id)
}
`);
  expect(rls).toContain(`EXISTS (SELECT 1 FROM public.comments s0 WHERE s0.post_id = id AND (s0.id = laforge_user_id()))`);
});

test('Collection predicate: .every()', () => {
  const rls = compileRls(`
  model Comment {
      id: uuid pk
      postId: uuid
      approved: boolean
  }
  model Post {
      id: uuid pk
      comments: hasMany(Comment)
  }
  
  policy Post.read {
      record.comments.every(c => c.approved === true)
  }
  `);
  expect(rls).toContain(`NOT EXISTS (SELECT 1 FROM public.comments s0 WHERE s0.post_id = id AND NOT (s0.approved = true))`);
});

test('Collection predicate: .includes()', () => {
  const rls = compileRls(`
  model User {
    id: uuid pk
  }
  model Team {
    id: uuid pk
    members: hasMany(User)
  }
  policy Team.read {
    record.members.includes(user.id)
  }
  `);
  expect(rls).toContain(`laforge_user_id() IN (SELECT s0.id FROM public.users s0 WHERE s0.team_id = id)`);
});

test('Negative: Chain depth limit exceeded', () => {
  expect(() => compileRls(`
  model A {
    id: uuid pk
  }
  model B {
    id: uuid pk
    aId: uuid
    a: belongsTo(A)
  }
  model C {
    id: uuid pk
    bId: uuid
    b: belongsTo(B)
  }
  model D {
    id: uuid pk
    cId: uuid
    c: belongsTo(C)
  }
  model E {
    id: uuid pk
    dId: uuid
    d: belongsTo(D)
  }
  
  policy E.read {
      record.d.c.b.a.id === user.id
  }
  `)).toThrow(/Chain depth limit exceeded/);
});

test('Negative: Invalid property in chain', () => {
  expect(() => compileRls(`
  model Team {
    id: uuid pk
  }
  model User {
    id: uuid pk
    team: belongsTo(Team)
  }
  
  policy User.read {
      record.team.nonExistent === "foo"
  }
  `)).toThrow(/Property "nonExistent" not found/);
});

test('Negative: Unsupported collection method', () => {
  expect(() => compileRls(`
  model User {
    id: uuid pk
  }
  model Post {
    id: uuid pk
    users: hasMany(User)
  }
  
  policy Post.read {
      record.users.filter(u => u.id === user.id)
  }
  `)).toThrow(/Unsupported method filter/);
});

test('Negative: Self-referential chain depth limit', () => {
  expect(() => compileRls(`
  model Category {
    id: uuid pk
    parentId: uuid
    parent: belongsTo(Category)
  }
  
  policy Category.read {
      record.parent.parent.parent.parent.id === user.id
  }
  `)).toThrow(/Chain depth limit exceeded/);
});
