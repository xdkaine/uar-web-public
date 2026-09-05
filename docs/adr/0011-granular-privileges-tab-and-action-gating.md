# ADR-0011: Granular privileges - tab and action gating

Status: Accepted

Amends: ADR-0003 point 4 (the outer admin gate stays, but the deferred "relax per-permission inside surfaces" work begins now for new and already-mapped surfaces).

## Context

RBAC today is real but shallow at the edges: a code-defined permission catalog, `RoleDefinition` rows mapped to AD groups, live resolution, and enforcement on configuration/review routes. But the admin dashboard renders every tab to every administrator (`app/admin/page.tsx`), most operational APIs sit behind the binary domain-admin gate, and there are no splits such as "view tickets but not respond". Operators want privileges like viewing ticket queues without replying, or reaching the admin area with only some tabs functional.

## Decision

**Tabs and actions become permission-driven; unmapped tabs stay administrator-only.**

1. **Tab permissions.** A code-defined `TAB_PERMISSIONS` map binds each dashboard tab to a permission key (existing keys where one fits: requests -> `access_requests.read`, settings -> `settings.manage`, logs/action-history -> `audit.read`, vpn -> `vpn.manage`). Tabs without a mapped key require the system-administrator role and remain invisible to everyone else. The session endpoint returns resolved roles plus flattened permissions so the client filters tabs; this is presentation-only convenience over server-side enforcement.
2. **New action-level keys** enter the catalog with enforcement at their routes in the same change: `tickets.read` (admin ticket queue/detail visibility), `tickets.respond` (staff responses/status changes), `service_alerts.read`, `service_alerts.manage`, `automation.manage`. New surfaces (service alerts, automation rules) are permission-gated from birth instead of being retrofitted later.
3. **Legacy compatibility unchanged**: domain administrators keep the full catalog via the legacy fallback; converting an existing binary-admin route to a permission check must grant system administrators that key (it does, by catalog membership) before the route's gate changes. Routes are converted incrementally; a route still on the coarse gate behaves as today.
4. **Fail-closed defaults**: a session with zero resolved permissions sees no gated tabs and receives 403 from gated APIs. UI hiding never substitutes for API checks (ADR-0006 lesson).
5. **Seeding**: no migration grants the new keys to director/faculty; mapping them onto additional roles is an operator decision made visibly in Roles & Access.

## Consequences

- Fine-grained access becomes composable by AD group immediately for the areas covered; each subsequent route conversion is a small, reviewable diff.
- Two sources of truth coexist temporarily (coarse gate vs permission gate); the TAB map documents which is which, and ADR-0003's follow-up list shrinks as conversions land.
- Reviewers who previously saw tabs their APIs reject now stop seeing them entirely (closing the cosmetic gap noted in ADR-0006).

## Alternatives considered

- Convert every admin route in one sweep: rejected - large blast radius across identity/lifecycle boundaries contradicts the staged-rollout contract; incremental conversion keeps day-one behavior identical.
- Object-level ACLs per ticket beyond owner/assignee/group rules: rejected - ticket ownership semantics from ADR-0007 already cover it; extra object tables add complexity without an operator need today.
