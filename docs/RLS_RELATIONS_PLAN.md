# Rich RLS Policy Support – Design Plan

## Goals

- Allow policies to reference deep relationship chains (`record.team.owner.id`).
- Support collection predicates (`record.team.members.some(member => ...)`, `.every`, `.includes`).
- Automatically expand those expressions into deterministic SQL (joins/subqueries) with tenant/user scoping.
- Preserve compile-time safety: invalid chains or unsupported helpers must produce clear errors.

## Architecture Overview

```
DSL Parser -> AST (enhanced) -> Relation Resolver -> SQL Planner -> SQL Generator
```

### 1. AST Enhancements

| Feature | AST shape |
| --- | --- |
| Property chain | `{ type: 'Chain', base: 'record', segments: ['team','owner','id'] }` |
| Collection predicate | `{ type: 'CollectionPredicate', method: 'some', collection: Chain, param: Identifier, body: Expression }` |
| Includes helper | `{ type: 'Includes', collection: Chain, value: Expression }` |

- Update parser to build these nodes when it encounters dot chains > 1 level or `.some/.every/.includes`.
- Validate param usage: inside `.some(member => ...)`, only `member.<field>` is allowed.

### 2. Relation Resolver

Responsible for turning a `Chain` AST into a series of relation hops:

```
record.team.members.some(...)
   └─ record (Post) ─belongsTo→ team_id → Team ─hasMany→ members → TeamMember
```

Implementation steps:
1. Walk the `segments` array.
2. At each hop, inspect the current model’s `relations`.
3. Distinguish between:
   - `belongsTo`: uses FK on current model.
   - `hasMany` / `manyToMany`: requires join via foreign table or join table metadata.
4. Build a resolved chain like:
   ```ts
   [
     { model: 'Post', alias: 'post', join: null },
     { model: 'Team', alias: 'team', join: { type: 'belongsTo', fk: 'team_id', pk: 'id' } },
     { model: 'TeamMember', alias: 'team_members', join: { type: 'hasMany', fk: 'team_id', pk: 'id' } },
   ]
   ```

Errors:
- Missing relation name → “Relation `team` not found on `Post`.”
- Ambiguous chain (e.g., referencing `members` on a model without such relation).
- Cycle detection: rely on existing relation cycle detector; enforce hop limit (default 3).

### 3. SQL Planner

Convert resolved chains + predicate AST into SQL fragments.

#### Property Chains
`record.team.owner.id === user.id`
1. Resolve `record.team` (belongsTo) → join `teams`.
2. Resolve `.owner` (belongsTo) → join `users`.
3. Final column: `users.id`.
4. Emit SQL: `post.team_id = team.id AND team.owner_id = user.id`.

Implementation idea:
- Maintain a map of required joins per policy; reuse same join when referenced multiple times.
- For `belongsTo`, add `JOIN target ON parent.fk = target.pk`.
- For `hasMany` / `manyToMany`, use `EXISTS` subqueries to avoid exploding result sets unless we need fields later.

#### Collection Predicates

| DSL | SQL |
| --- | --- |
| `collection.some(predicate)` | `EXISTS (SELECT 1 FROM … WHERE joins AND predicate)` |
| `collection.every(predicate)` | `NOT EXISTS (SELECT 1 FROM … WHERE joins AND NOT predicate)` |
| `collection.includes(value)` | `value IN (SELECT …)` |

Steps:
1. Resolve the collection chain (must end on a `hasMany` or `manyToMany`).
2. Build subquery:
   ```sql
   EXISTS (
     SELECT 1 FROM team_members tm
     WHERE tm.team_id = team.id
       AND /* predicate translated */
   )
   ```
3. Translate predicate body by treating the param identifier as the row alias (`member.email`, etc.).

### 4. Expression Translation

Extend `nodeToSql`:
- Accept a context `{ scope: 'record' | 'user' | 'collection', model: ModelDefinition, alias: string }`.
- When translating `member.user === user.id`, look up `member.user` chain relative to collection model.
- Supported operators: `===`, `!==`, `<`, `>`, `<=`, `>=`, logical `&&`, `||`, unary `!`.
- Block unsupported features (function calls besides allowed helpers, arithmetic beyond `+`/`-` for now).

### 5. Tenant Safety

Whenever a chain reaches a model with a `tenant` field:
- Inject `AND child.tenant_id = current_setting('app.tenant_id')` into join/subquery automatically.
- If a policy explicitly compares tenant fields, still include the guard (idempotent).
- For multi-tenant apps, reject cross-tenant joins (e.g., referencing a model without tenant column unless flagged).

### 6. Surface & Errors

- Provide CLI flag `forge generate --show-policy-sql` that prints the SQL per policy for review.
- Error message examples:
  - `Unsupported depth (4 hops). Maximum allowed is 3.` (configurable)
  - `Collection helper ".filter" is not supported. Use ".some" or ".every".`
  - `Relation "members" on "Team" points to "User" but lacks foreign key metadata.`

### 7. Test Plan

**Unit tests**
- `record.owner === user.id` (baseline).
- `record.team.owner.id === user.id` (two `belongsTo` hops).
- `.some` across `hasMany`.
- `.every` + negation.
- `.includes(user.id)` with join table.
- Negative: missing relation, unknown helper, unsupported depth, user-defined function.

**Integration tests**
- Add sample domains representing:
  - Multi-hop join (Project → Team → Members → User).
  - Many-to-many (File ↔ Folder via FolderOwners).
  - Nested `.some` inside logical expressions.
- Validate generated SQL against snapshots.

**Performance**
- Run stress tests with >10 relations and ensure the join planner dedups joins.

### 8. Implementation Sequence

1. AST changes + parser validation.
2. Relation resolver module + tests.
3. SQL planner (property chains first).
4. Collection predicates.
5. Tenant guard integration.
6. CLI surface / diagnostics.
7. Documentation & Studio updates.

---

This document is the blueprint; next steps are to spike AST + resolver prototypes, then land them incrementally behind feature flags if needed.
