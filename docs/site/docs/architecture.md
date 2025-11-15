---
id: architecture
title: Architecture Overview
sidebar_position: 3
---

```
[ domain.ts (DSL) ]
        |
        v
[ Parser / AST ]
        |
        v
[ Registry / Validation ]
        |
        v
+-------------------------------------------------------------+
|                       CODEGEN                               |
|  + Zod Schemas       + Domain Services       + RLS Policies |
|  + Route Handlers    + Types/Models          + Runtime Glue |
+-------------------------------------------------------------+
        |
        v
[ Diff Engine ] ----→ [ Adapters: Postgres/MySQL/SQLite ]
        |
        v
[ Migrations (.laforge/) ]
        |
        v
forge migrate
```
