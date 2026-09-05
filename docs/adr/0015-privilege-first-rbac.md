# ADR-0015: Privilege-first RBAC mapped directly to AD groups

Status: Accepted (supersedes the role-mapping stage of ADR-0004/ADR-0006)

## Context

ADR-0004 introduced DB-stored `RoleDefinition` rows (permissions + `adGroupDns`) resolved against live directory membership, with legacy `ldap.adminGroups` domain administrators and break-glass accounts always retaining the full catalog. Operators found the intermediate role layer confusing: they think in capabilities ("who can run mass email?") and AD groups, not in named portal roles. Every capability also now has a visible admin surface, but tabs without an entry in `TAB_PERMISSIONS` were implicitly reserved for legacy system administrators, so they could never be delegated.

Two structural facts constrained the design:

1. 79 admin API routes relied **solely** on the strict gate (`checkAdminAuthWithRateLimit`), which required legacy domain-admin membership. Any relaxation of that gate without per-route checks would hand every mapped user the entire admin API surface.
2. Authorization resolution is fail-open for the legacy tier (an unreadable role store must never lock domain admins out) and fail-closed for mapped reviewers (directory errors grant nothing).

## Decision

**Privileges map directly to AD groups; roles are retired from the authorization path.**

1. **Storage**: new `PrivilegeAssignment` (`permissionKey @id`, `adGroupDns[]`). A missing row means "nobody mapped". The permission catalog stays code-frozen (`lib/rbac/permissions.ts`) and expanded with privileges for every previously implicit-admin surface (`users.*`, `events.manage`, `batch.manage`, `blocklist.manage`, `sessions.*`, `lifecycle.manage`, `sync.read`, `communications.manage`, `offboard.manage`, `password_expiration.*`, `ratelimits.manage`, `access_requests.respond`, `access_requests.provision`, `admin.search`). `TAB_PERMISSIONS` now binds every admin console entry. `RoleDefinition` rows are retained read-only for rollback and no longer consulted; the legacy roles config API (`/api/admin/config/roles`) enforces this retention — `GET` still serves the stored rows merged with catalog defaults, while `PUT`/`PATCH`/`DELETE` are rejected with 405 and write no audit entries. The table and seed data remain untouched.
2. **Resolution** (`lib/rbac/core.ts`): one live `memberOf` lookup per request, matched canonically against every assignment's group DNs (same hardened parser as the legacy gate). Legacy domain admins and break-glass accounts receive the full catalog; fail-open/fail-closed semantics are unchanged. The synthetic `system_administrator` role key survives only as a display marker.
3. **Gate relaxation with defense in depth**: `checkAdminAuth*` now admits any session resolving ≥1 privilege. To keep this safe, **every** previously gate-only admin route gained an explicit `actorHasPermission(admin, '<privilege>')` 403 guard (read vs. mutate split where meaningful, e.g. `sessions.read`/`sessions.revoke`). Elevation alone grants nothing beyond the gate. `track-view` remains gate-only telemetry.
4. **Elevation**: login/OIDC set `isAdmin` when resolution yields ≥1 privilege (was: ≥1 role). Mapped users see exactly the console entries their privileges cover; disabled capability modules gray their entries out.
5. **UI**: the Roles panel is replaced by Privileges & Access — the catalog grouped by area, each privilege edited to a list of AD groups with DN autocomplete and audit trail. The legacy `ldap.adminGroups` mapping is displayed as the always-full "legacy full-administrator" grant and configured in Directory & Email.

## Consequences

- Delegation is now expressible per capability; no role taxonomy to maintain.
- The 79 per-route guards are the load-bearing safety net; new admin routes MUST add a privilege check (the gate no longer implies full authority).
- Migration `20260825120000_privilege_first_rbac` unions existing role→(permission, group) pairs into assignments; rollback is application-level (revert to a role-based build; `RoleDefinition` was never modified).
- The roles config API can no longer acknowledge writes that authorization ignores: mutating it previously reported success (with `UPDATE_SETTINGS` audit entries) while the resolution path never read those rows, so the write surface was removed rather than left as a misleading control.
- Mapped non-domain-admins can now reach admin API routes that enforce their privilege — intended, and the reason the per-route audit preceded the gate change.

## Alternatives considered

- Keep roles, redesign the panel: rejected — preserves the indirection operators rejected.
- Privilege-first UI writing through to roles: rejected — two sources of truth with confusing merge semantics.
- Relax the strict gate without per-route checks: rejected — would grant every mapped user the entire admin API (mass email, offboarding, user mutations).
