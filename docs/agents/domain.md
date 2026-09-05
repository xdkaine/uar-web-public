# Domain Documentation

`CONTEXT-MAP.md` is the routing entry point for domain work. It identifies the stable contexts, their source boundaries, and the specialist reviewer used for each.

## Consumer rules

1. Read `AGENTS.md` and `CONTEXT-MAP.md` before planning a behavior change.
2. Read every affected context's `CONTEXT.md`; do not load unrelated contexts by default.
3. Check `docs/adr/` and the context's `adr/` directory when either exists.
4. Use the vocabulary and invariants defined by the context. Do not invent replacement state names or weaken a required invariant to match an implementation shortcut.
5. Surface conflicts between code, context documentation, and ADRs. Do not silently choose one.
6. Update context documentation when a deliberate, approved change alters a stable responsibility, invariant, trust boundary, or recovery model.

Context documentation records durable rules. Counts, route inventories, generated schemas, logs, and other fast-changing evidence should be derived from the current repository rather than copied into context files.
