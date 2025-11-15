---
id: plugins
title: Plugin Guide (High Level)
sidebar_position: 6
---

Goal: let plugins hook compiler events and outputs.

Recommended interface (roadmap):
```ts
interface LaForgePlugin {
  name: string;
  preParse?(source);
  postParse?(ast);
  preCodegen?(ast);
  postCodegen?(generated);
  preMigration?(schemaDiff);
  selectAdapter?(db);
  emit?(files);
}
```

Goals:
- Intercept compiler lifecycle
- Extend DSL
- Add outputs/codegen targets
- Customize adapters or migrations

Roadmap: a full Plugin SDK + test harness.
