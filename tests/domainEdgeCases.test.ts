import { describe, expect, it } from 'vitest';
import { compileForSandbox } from '../packages/compiler/index.js';

const EDGE_CASE_DSL = `
model Team {
  id: uuid pk
  name: string
  region: string optional
}

model File {
  id: uuid pk
  title: string
  description: text optional
  byteSize: integer
  rating: integer optional
  flagged: boolean optional
  publishedAt: datetime optional
  metadata: jsonb
  ownerId: uuid optional
  owner: belongsTo(Team)
}

policy File.read {
  ({ user, record }) => record.owner.region === user.role || record.ownerId === user.id
}
`;

describe('Domain edge cases', () => {
  it('compiles models that use optional fields, jsonb, integers, and belongsTo chains', () => {
    const compiled = compileForSandbox(EDGE_CASE_DSL);
    const team = compiled.models.find((m) => m.name === 'Team');
    const file = compiled.models.find((m) => m.name === 'File');
    expect(team).toBeTruthy();
    expect(file).toBeTruthy();

    expect(team?.schema.region).toMatchObject({ type: 'string', optional: true });

    expect(file?.schema.description).toMatchObject({ type: 'text', optional: true });
    expect(file?.schema.byteSize).toMatchObject({ type: 'integer', optional: false });
    expect(file?.schema.rating).toMatchObject({ type: 'integer', optional: true });
    expect(file?.schema.flagged).toMatchObject({ type: 'boolean', optional: true });
    expect(file?.schema.publishedAt).toMatchObject({ type: 'datetime', optional: true });
    expect(file?.schema.metadata).toMatchObject({ type: 'jsonb', optional: false });
    expect(file?.schema.ownerId).toMatchObject({ type: 'uuid' });

    // Verify the relation metadata was created
    const fileOwnerRelation = file?.relations.find((rel) => rel.name === 'owner');
    expect(fileOwnerRelation).toBeTruthy();
    expect(fileOwnerRelation?.targetModelName).toBe('Team');
    expect(fileOwnerRelation?.foreignKey).toBe('ownerId');
  });
});
