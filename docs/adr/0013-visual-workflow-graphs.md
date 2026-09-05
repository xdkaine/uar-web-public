# ADR-0013: Visual workflow graphs over an expanded curated catalog

Status: Accepted (supersedes ADR-0008)

## Context

ADR-0008 delivered rule-based automation (trigger + all-conditions + ordered actions) with three triggers, two conditions, six actions, and an idempotent run ledger. Operators now need multi-step, time-aware processes — ticket triage chains ("ticket created → topic matches → enqueue group add → auto-reply → close"), directory-outage ladders ("primary DC down → wait → still down → raise alert + email directors"), and cleanup guarantees ("artifacts a workflow created disappear when the condition clears"). They want to design these visually, n8n-style, on a grid canvas rather than as flat WHEN/IF/THEN rows.

The ADR-0008 governance invariant stands: no arbitrary code, no expression language, no HTTP-call nodes, and no path that mutates AD outside the lifecycle queue. "Full freedom" means free composition of reviewed primitives — including branching, waiting, looping over bounded lists, and graph-shaped composition — not script execution.

## Decision

**Versioned directed graphs executed by a persisted engine.**

1. **Storage**: `WorkflowGraph` holds node/edge JSONB plus draft/published versions; published versions are immutable and enabling one is an audited act (rules import as graphs; `AutomationRule` is deprecated). Graphs validate on save *and* on execution: acyclic, single trigger root, every node matches the catalog schema, fan-out bounded.
2. **Node catalog (curated, code-defined, extensible)**:
   - *Triggers*: `schedule` (cron), `ticket_created`, `ticket_replied`, `ticket_status_changed`, `dc_unreachable`, `dc_recovered`, `lifecycle_action_completed`, `lifecycle_action_failed`.
   - *Logic*: `condition.branch` (typed field comparisons from the trigger context), `delay.wait` (persisted timers), `fork.parallel`.
   - *Actions*: `send_email` (any registered message-template key), `create_service_alert` / `resolve_service_alerts` (upsert semantics retained), `create_notification_banner` / `clear_notification_banner`, `add_ticket_response`, `close_ticket`, `enqueue_group_add` / `enqueue_group_remove` (always through the lifecycle queue).
3. **Execution**: emissions carry event keys; `(graphId, eventKey)` uniqueness prevents double-fire (inherited from ADR-0008). Runs persist per-node outcomes, timing, input digest, and errors into `WorkflowRun`; a failed node halts its branch only. Delayed nodes persist `WorkflowTimer` rows drained by a 60-second tick worker (new cron sidecar), so waits survive restarts.
4. **Artifact tracking and cascade cleanup**: every side effect a run creates records a `WorkflowArtifact` row (`service_alert`, `notification_banner`, …) referencing the created object. Resolving/dismissing a service alert offers engine-managed cleanup: artifacts linked by dedupe key are cleared with it. Workflows clean up after themselves instead of littering banners and alerts.
5. **Designer**: React Flow grid canvas replaces the WHEN/IF/THEN builder — palette grouped by category, wire drawing, inspector drawer per node, validation-before-publish, sample-context test runs, and run history replayed onto the canvas. Management stays behind `automation.manage`.
6. **Scheduler visibility**: the operations dashboard surfaces `CronRun` rollups, scheduler health, and `WorkflowRun` outcomes so operators can see the whole machine.

## Consequences

- Operators express multi-step operational processes without deployments; auditors read one run ledger explaining every automated effect.
- Capability growth means shipping reviewed nodes — blast radius stays legible.
- Persisted timers add a second moving part (tick worker); missed ticks resume late, never double-fire.
- Review-stage request statuses remain untouched (ADR-0002 scope note carries forward).

## Alternatives considered

- Keep flat rules and extend them ad hoc: rejected — conditions-on-actions cannot express sequencing, waiting, or branching without contortions.
- Deploy real n8n: rejected — arbitrary code/HTTP nodes, a separate credential store, and an independent auth surface violate the auditability posture this repository runs on.
- Generic expression/BPM engine: rejected again, for the reasons recorded in ADR-0008.
