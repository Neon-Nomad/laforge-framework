# LaForge DSL Specification (current compiler behavior)

This document reflects exactly how the shipped compiler parses, validates, and generates artifacts from the LaForge DSL today.

## 1) Grammar
- **Models**: `model ModelName { field: type [modifiers] [,] ... }` (commas optional; whitespace/line breaks are ignored). Single-line `//` comments are stripped.
- **Relations**: declared in-line as fields with `belongsTo(Target)`, `hasMany(Target)`, or `manyToMany(Target)`.
- **Policies**: `policy Model.action { <JS/TS expression or arrow function body> }`, where `action` ∈ {create, read, update, delete}.
- **Hooks**: `hook Model.hookType { <function body> }`, with hookType ∈ {beforeCreate, afterCreate, beforeUpdate, afterUpdate, beforeDelete, afterDelete}.
- **Extensions**: `extend Model { method(args) { ... } ... }` are parsed and carried as source; not executed by the compiler.
- Multiple blocks can appear in any order; relations are resolved after all models are discovered.

## 2) Field types
- Primitives: `uuid`, `string`, `text`, `integer`, `boolean`, `datetime`, `jsonb`, `json` (unions are not supported).
- `int` is normalized to `integer`.

## 3) Nullability / optional rules
- Add the keyword `optional` after a field to make it nullable.
- If `optional` is not present the compiler **sets `optional: false` explicitly** (all columns are NOT NULL by default).
- Primary keys must be non-optional.
- Generated belongsTo foreign keys default to `optional: false` unless explicitly marked optional in the DSL.

## 4) Modifiers and defaults
- `pk` marks a primary key. If no explicit pk is set and an `id` field exists, `id` is promoted to pk.
- `tenant` marks a tenant-scoped column. When multi-tenant mode is on (default), RLS adds a tenant equality check automatically.
- `unique` marks a unique column (SQL generation adds `UNIQUE`).
- `default <value>` captures raw SQL defaults: string literals `"..."`/`'...'` or bare identifiers/functions (e.g., `now()`, `uuid_generate_v4()`).
- `pii` marks fields as sensitive for redaction/masking in runtime responses.
- `secret` marks highly sensitive fields; treated the same as `pii` for masking.
- `residency(<region>)` captures an optional data residency tag (e.g., `residency(us-east)`).
- `secret` fields are encrypted at runtime when `LAFORGE_SECRET_KEY` is set; residency tags are enforced on create/update when `DATA_RESIDENCY`/`LAFORGE_RESIDENCY` is set.

## 5) Relations and cardinality
- **belongsTo(Target)**: creates a relation entry and, if missing, an FK column named `<fieldName>Id` of type `uuid`, `optional: false`, `onDelete: cascade`.
- **hasMany(Target)**: creates a relation entry; references a remote FK column in Target named `<thisModelCamel>Id`; `onDelete: cascade`.
- **manyToMany(Target)**: creates a relation entry with `through` set to a join table named `modelA_modelB` (sorted alphabetically, lowercased, snake) with a trailing `s`.
- Relation names are author-controlled; FK names are deterministic as above.
- Cycle detection: any relation cycle throws (self-belongsTo is allowed).
- Max relation traversal depth in policies: 3 hops.

## 6) Naming rules (SQL)
- Tables: `public.<snake_case(model)>s` (simple plural “s”; `Company` → `companys`, `Story` → `storys`).
- Columns: `snake_case(field)`.
- Foreign keys use the camelCase-to-snake version of the generated FK names above.

## 7) Migration semantics
- The compiler diffs the previous snapshot vs. current models and emits migrations.
- `allowDestructive` defaults to `false`; destructive ops (drops, type changes tightening nullability) are **skipped** and listed as `-- WARNING: ...`. Companion `_fallback.sql` is emitted with non-destructive shadow columns/steps and an explicit WARNING banner.
- Non-destructive statements are emitted into `<timestamp>_schema.sql`.
- When no diff operations exist, no new migration files are written; snapshots are still updated.

## 8) Type inference behavior (TypeScript)
- `Infer<ModelSchema>`:
  - Required properties: all fields without `optional: true` and not relations.
  - Optional properties: fields with `optional: true`.
- Primitive mapping: uuid/string/text → `string`; integer → `number`; boolean → `boolean`; datetime → `Date`; json/jsonb → `any`.

## 9) RLS policy generation rules
- Policies are generated per model; table RLS is enabled and existing forge policies are dropped before recreation.
- Tenant guard: if a field is marked `tenant` and multiTenant=true, RLS adds `tenantField = laforge_tenant_id()` to SELECT/INSERT/UPDATE/DELETE.
- User context allowed properties: `user.id`, `user.tenantId`, `user.role`; other properties throw.
- Supported expressions:
  - Logical `&&`/`||`, comparisons `===`, `!==`, `==`, `!=`, `>`, `<`, `>=`, `<=`, unary `!`.
  - String/number/boolean literals.
  - Property chains over `record` with relation hops (max 3), generating JOIN-backed scalar subqueries; enforced tenant checks on joined models that have `tenant`.
  - Collection predicates: `.some`, `.every`, `.includes` on relation collections; unsupported methods throw.
- Unsupported nodes (e.g., TemplateLiteral, bare identifiers, unknown vars) throw compilation errors; expected by tests.
- Default policies when absent:
  - SELECT: tenant-only if tenant guard exists, otherwise none.
  - INSERT: WITH CHECK tenant guard (or `true` if none).
  - UPDATE/DELETE: tenant guard if present, otherwise none.

## 10) Frontend generator expectations
- React scaffold is generated with:
  - Routes per model: `/` + kebab plural of model name (`Story` → `/storys`).
  - Display field: first non-PK, non-tenant string/text field; fallback to pk.
  - List fields: display field, pk, then up to two more excluding `tenantId` and password-like names.
  - Field metadata includes `optional` and `primaryKey` flags from the schema.
- Relations from the schema are passed through; join naming follows back-end rules above.

## 11) Validation and errors
- Unknown relation targets, duplicate policies per action, missing primary keys, cyclic relations (non-self), unsupported RLS AST constructs, and excessive relation chain depth all raise compilation errors.
- Bare models or syntax issues in blocks surface as user-facing “Compilation Error” messages.

## 12) Migration + timeline integration (CLI/Studio context)
- Snapshots are recorded after each successful migration generation; diffs drive timeline/ERD views.
- Safe-mode fallbacks are written alongside skipped destructive migrations for manual application.
