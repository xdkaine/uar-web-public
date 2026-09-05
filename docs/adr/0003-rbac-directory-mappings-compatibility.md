# ADR-0003: RBAC roles, directory mappings, and legacy admin compatibility

Status: Accepted

## Context

Authorization is currently flat: every admin surface requires `session.isAdmin` plus a live LDAP domain-admin check (`LDAP_ADMIN_GROUPS`). Governance stages have no distinct reviewer identity — any domain admin can action any stage. The roadmap (§9) requires distinguishable roles while preserving the live directory validation boundary and current access on day one.

## Decision

1. **Code-defined permission catalog** (`lib/rbac/permissions.ts`): permissions exist only if registered. Initial set covers configuration surfaces and request review.
2. **Database role definitions** (`RoleDefinition`): key, name, permissions (validated against the catalog), `adGroupDns`, and an `isSystem` flag. Seeded: `system_administrator` (full catalog), `director`, `faculty`.
3. **Resolution order** per actor (`lib/rbac/core.ts`):
   1. *Legacy compatibility*: the existing live domain-admin check grants `system_administrator` with the full catalog — identical effective access to today. This is also the failure-mode fallback when role data is unreadable, so an outage can never lock administrators out.
   2. *Directory mappings*: one live `memberOf` lookup compared canonically against each role's configured DNs (reusing the hardened DN parser from `lib/ldap/admin-groups.ts`).
4. **The outer gate is unchanged this iteration**: admin APIs still require session + live domain-admin membership before permission checks run. Role mappings therefore add *stage-level* distinctions inside the admin population; relaxing the outer boundary for non-admin directors/faculty is deferred until mappings are trusted in production (roadmap Phase 4 continues).
5. **Stage enforcement** uses `actorCanActOnStage`: system administrators act on any stage; others need the permission bound to the stage's reviewer role.
6. Configuration UI edits only `adGroupDns` for all roles; `system_administrator`'s permission list is immutable through the API so the legacy fallback can never become weaker than pre-RBAC behavior.

## Consequences

- Day-one behavior is unchanged; adding group DNs to director/faculty roles makes stage requirements real without code changes.
- Invalid stored DNs never break authorization resolution — they simply fail to match until corrected.
- Follow-up work: relax outer gate per-permission, explicit per-user assignments, auditor read-only role.

## Alternatives considered

- Immediate removal of the domain-admin outer gate: rejected — violates compatibility contract #1/#9 without validated mappings.
- DB-only role definitions without a code catalog: rejected — allows untyped permission sprawl.
