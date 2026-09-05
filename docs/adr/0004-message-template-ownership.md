# ADR-0004: Message template ownership for operational copy

Status: Accepted

## Context

Operational copy such as the faculty handoff message is hard-coded in React components (previously `app/admin/requests/[id]/page.tsx` `generateFacultyMessage`). Operators reasonably need to edit this text without a code release (roadmap §11, §17).

## Decision

1. **Catalog-first templates** (`lib/messages/catalog.ts`): a template key exists only if registered with its label, the exact current hard-coded body as the default, and documented placeholders. Initial catalog: `faculty.handoff_message`.
2. Runtime content lives in the additive `MessageTemplate` table seeded by migration with the exact default text; **first deployment renders byte-identical output**.
3. Resolution: stored body when present, code default otherwise; store failures fall back to defaults. Writes require the key to be registered and validate non-empty content with a size cap.
4. Rendering substitutes `{{placeholders}}` via a shared function (`lib/messages/core.ts`); unknown placeholders are left intact so template mistakes fail visibly instead of silently dropping data. The client uses the same substitution semantics.
5. Template edits are audited (`MessageTemplate` target) with previous/new lengths.

## Consequences

- Editing copy no longer requires deployment; reverting to factory text is a UI delete away (absent row = default).
- Rich versioned drafts/published states, WYSIWYG editing, and email HTML templates remain future work per roadmap §11; this change establishes the ownership boundary and seed-from-current-content pattern they will follow.

## Alternatives considered

- Environment-variable copy: rejected — content is organization policy, not deployment configuration, and needs multi-line editing ergonomics.
