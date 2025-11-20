# Why LaForge Exists

LaForge is not an ORM and not a codegen toy. It is a compiler that treats your domain as the only source of truth and forces every artifact to be derived from one AST. This is the missing half of launch readiness: the “why” behind the DSL.

## 1. Schema drift is a trillion‑dollar silent disaster
- Conventional ORMs, migration runners, and frameworks tolerate divergence between schema, code, and security. They depend on humans to keep things aligned, so drift creeps in with every sprint.
- LaForge eliminates drift by compiling a single domain AST into SQL, RLS, services, routes, migrations, frontend scaffolding, and an auditable history. There is no second source of truth to decay.

## 2. Codegen is not enough—compilation is permanent
- Code generators produce throwaway files you must maintain; they add entropy.
- LaForge compiles: the DSL is the input, everything else is derived. Re‑runs are idempotent, and repair flows regenerate outputs instead of leaving rot behind.

## 3. One AST drives the full stack
- Backend, frontend, security, migrations, and runtime bindings all come from the same tree.
- The AST is consumed consistently: SQL/RLS share the same relations the UI renders; migrations diff the exact same schema the routes and Zod schemas use.

## 4. RLS is first‑class, not an add‑on
- Policies are written in the DSL and compiled into SQL that matches the domain relationships (including tenant checks).
- RLS evolves with schema changes automatically; there is no separate policy layer to drift.

## 5. Self‑healing migrations change the game
- The compiler detects destructive edits and emits safe fallbacks plus explicit warnings.
- The auto‑migrate repair flow records before/after snapshots and fixes broken SQL, turning migration pain into a recoverable, traceable operation.

## 6. Schema time‑travel is the missing half of Git
- Git manages files; LaForge manages structure. Timeline snapshots, branch‑aware diffs, cherry‑picks, and in‑memory replays give database models Git‑level ergonomics.
- ERD visualizations, blame views, and field‑level diff highlighting show exactly what changed and why.

## 7. The frontend compiler closes the loop
- Most tools stop at the database or service tier. LaForge emits a working React application (lists, detail forms, inferred relations) from the same AST.
- The UI is branch‑ and snapshot‑aware: ERDs, timelines, and blame tools are surfaced for humans, not just machines.

## 8. The operating model
- Write DSL → compile → ship. No manual stitching of migrations, RLS, routes, or UI.
- Branch, compare, and replay schemas like code. Drift is impossible because the compiler refuses to emit contradictions.
- The payoff: less time debugging drift, more time shipping features, and a security posture that matches the domain instead of living in a wiki.
