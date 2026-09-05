# ADR-0008: Configurable workflow automation over a curated primitive catalog

Status: Superseded by [ADR-0013](0013-visual-workflow-graphs.md) (visual workflow graphs over an expanded curated catalog). The curated-primitives governance invariant, idempotency model, and lifecycle-queue rule carry forward; flat trigger/condition/action rules import as graphs.

Scope note: this decision governed event-driven operational automation. It does not replace ADR-0002's versioned review-stage machine for access requests; request statuses and transitions stay exactly as they are.

## Context

Operators want the portal to react automatically to operational events instead of relying on manual checks: a domain controller going offline should raise a categorized service alert an administrator can dismiss; expired accounts found by scans should surface work items with email notification; a support ticket requesting membership in an approved AD group should be processed without human bottleneck when policy allows.

ADR-0002 and roadmap section 8 rejected a generic workflow engine because dynamic statuses and free-form logic break UI filters, reporting, compatibility contracts, and governance reviewability. The operator requirement has since grown beyond what hand-coded cron jobs can express: users need to see what automation exists, change its parameters, and add rules for new groups or alert categories without code changes.

## Decision

**Free composition over curated primitives.** Rules compose three code-defined catalogs - triggers, conditions, actions - but composition itself is data (`AutomationRule` rows), so operators can create arbitrary rule shapes without code changes. Anything outside the catalogs requires code, never configuration.

1. **Triggers** are typed portal events emitted at well-defined integration points, each carrying a validated context payload: `dc_unreachable`, `dc_recovered`, `ticket_created` (initial set). New triggers land as code with schema-validated payloads.
2. **Conditions** are named predicates over the trigger context (for example `context_field_equals`). All conditions on a rule must match; evaluation is fail-closed (an unreadable context denies the rule).
3. **Actions** are vetted operations with declared side effects: `create_service_alert` (upsert by dedupe key), `resolve_service_alerts`, `send_email` (fixed recipients from rule config through the existing transport), `enqueue_group_add` (creates a queued `AccountLifecycleAction`; never binds LDAP inline), `add_ticket_response`, `close_ticket`. Actions run in listed order; each outcome is recorded.
4. **Idempotency**: every emission carries an event key; `AutomationRun` enforces uniqueness of `(ruleId, eventKey)` so redelivery cannot double-fire. Alert creation upserts on a stable dedupe key and increments occurrence counters instead of duplicating rows.
5. **Governance**: rule management requires the new `automation.manage` permission behind the existing admin gate. Rules default to disabled on seed; enabling one is a deliberate, audited act. Every run persists input digest, per-action outcomes, errors, and timing.
6. **No arbitrary code or scripts**: rule JSON may only reference catalog keys and scalar parameters validated against each primitive's schema. There is no expression language, no HTTP-call action, and no path that mutates AD directly - external mutations always flow through the lifecycle queue so claims, retries, and rollback semantics stay owned by lifecycle processing.

## Consequences

- Operators gain user-visible, editable automation (alerts, notifications, group-join processing) without deployments; auditors get one table that explains every automated effect.
- The engine cannot do anything the primitive catalog cannot; expanding capability means shipping reviewed primitives, which keeps blast radius legible.
- Rule JSON is validated on write AND on evaluation; a catalog entry removed by future code disables dependent rules loudly rather than misfiring.
- Review-stage governance remains a separate machine; the engine reacts to events but never rewrites request statuses.

## Alternatives considered

- Keep hard-coding each automation as cron logic: rejected - every new "if X then Y" becomes a deployment, and operators cannot see or adjust behavior.
- Generic BPM/expression engine: rejected again - unreviewable logic over privileged mutations violates the auditability invariant this repository runs on; curated primitives are the compromise between ADR-0002's rejection and current needs.
- Evaluating actions inline during event emission with retries dropped: rejected - cross-system mutation ordering and retry safety belong to the lifecycle queue.
