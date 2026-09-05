# ADR-0001: Capability module registry and VPN decoupling

Status: Accepted

## Context

VPN management (tracking records, imports, portal role changes, and VPN side effects inside access requests, lifecycle, offboarding, batch, and infrastructure sync) is entangled with core governance flows. It serves a purpose for some deployments but not others. Disabling it must not delete `VPNAccount`, import, status-log, or audit data, and must not break unrelated capabilities (roadmap §2 contract 4, §5).

## Decision

1. Introduce a **capability module registry** defined in code (`my-app/lib/modules/registry.ts`). A module id exists only if registered there. The initial registry contains exactly one module: `vpn.management`.
2. Runtime state lives in the additive `ModuleState` table keyed by module id with an `enabled` boolean. **A missing row always resolves to enabled**, so the first deployment after this change behaves identically to today.
3. Resolution fails open: if the state store is unreadable, modules resolve to enabled so configuration outages cannot take unrelated capabilities down. Toggle changes are audited (`ModuleState` target) and cached briefly (30s) with explicit cache invalidation on write.
4. Two guard styles:
   - Routes use `requireModuleEnabled('vpn.management')` (`lib/modules/guards.ts`) which returns a consistent `503` JSON body `{ error, code: 'MODULE_DISABLED', moduleId }`.
   - Shared business logic uses `isModuleEnabled()` / `assertModuleEnabled()` and skips VPN work explicitly, recording the skip (e.g. lifecycle completion details record `linkedVpnSkippedReason: 'vpn_module_disabled'`).
5. VPN producers are gated at six sites: acknowledge tracking-record creation, approve activation, create-account upsert/provisioning, manual-assign updates, batch VPN loop, and infrastructure-sync re-seeding. Reads are never gated: historical VPN data remains browsable while the module is disabled.
6. Navigation hides gated tabs when the module is disabled; deep links render an explanatory notice instead of the tool.

## Consequences

- Disabling VPN makes external-user approvals AD-only flows: no VPN username requirement, no second LDAP enablement, no VPN record activation, no rollback triggered by VPN failures.
- Sync-status suppresses missing-VPN issue classes while disabled, otherwise every new identity would raise false findings.
- Legacy queued VPN lifecycle actions fail explicitly with a clear error rather than silently succeeding or being deleted; new VPN-only actions are blocked at intake.

## Alternatives considered

- Scattered boolean settings columns: rejected — produces inconsistent checks and untestable coupling (roadmap §5).
- Deleting VPN code/tables: rejected — data preservation and reversibility are mandatory.
