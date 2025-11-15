import { expect, test } from 'vitest';
import { parseForgeDsl } from '../packages/compiler/index.js';

test('parses models, fields, and relations into the AST', () => {
  const models = parseForgeDsl(`
model User {
  id: uuid pk
  name: string
  posts: hasMany(Post)
}

model Post {
  id: uuid pk
  title: string
  author: belongsTo(User)
}
`);

  const user = models.find(m => m.name === 'User');
  const post = models.find(m => m.name === 'Post');

  expect(user).toBeTruthy();
  expect(Object.keys(user!.schema)).toContain('id');
  expect(post?.relations[0]?.type).toBe('belongsTo');
  expect(post?.relations[0]?.targetModelName).toBe('User');
});
