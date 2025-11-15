---
id: dsl-guide
title: DSL Guide
sidebar_position: 1
---

```forge
model User {
  id: uuid pk
  tenantId: uuid tenant
  email: string
  role: string
}

model Post {
  id: uuid pk
  tenantId: uuid tenant
  title: string
  body: text
  author: belongsTo(User)
}

policy Post.read {
  ({ user, record }) =>
    record.tenantId === user.tenantId ||
    user.role === "admin"
}

hook Post.beforeCreate {
  record.slug = record.title.toLowerCase().replace(/\s+/g, '-')
}
```

Highlights:
- Models define schema + relations.
- Policies become RLS + runtime guards.
- Hooks allow mutation/validation logic.
- Tenant fields enforce isolation.
- Everything compiles from a single AST.
