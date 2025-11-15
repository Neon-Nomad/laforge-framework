## Phase 4 (Performance + Ergonomics) Plan

Now that LaForge is hardened, improve comfort and performance — without changing correctness.

### 1) Diff Planner Optimization
- Memoize table comparison results.
- Flatten deep recursion into iterative loops.
- Pre-index column names/types for O(1) lookup.
- Move destructive-op detection into a lightweight helper.

Result: faster planning on large domains.

### 2) Better Error Messages
- Show model + field name.
- Show DSL snippet.
- Show expected vs actual structure.
- Offer fixes (e.g., “rename field, don’t delete type”).

### 3) CLI Ergonomics
- `forge generate`: show a summary table (models/services/schemas/policies/routes/migrations).
- `forge diff`: highlight dangerous operations (skipped drops, renames).
- `forge status`: show migration history cleanly.

### 4) Runtime Performance
- Cache compiled domain service functions.
- Pre-resolve model metadata.
- Pool prepared statements per adapter.
- Consolidate tenant scoping per request.

### 5) Developer Experience
- VS Code DSL highlighting + snippets.
- CLI auto-completion.
- `forge doctor` for env checks and suggestions.
