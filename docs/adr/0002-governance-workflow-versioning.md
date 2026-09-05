# ADR-0002: Versioned access-request review workflows and reviewer configuration

Status: Accepted

## Context

The access request review chain (student directors, then faculty) is hard-coded: status strings, transition guards, reviewer email recipients, and stage labels live in route handlers. Operators need to configure which stages exist, what they are called, who reviews them, and where notifications go — without changing in-flight requests retroactively (roadmap §8).

## Decision

1. **Constrained model, not a generic engine.** Stages are selected from a code-defined catalog (`lib/workflow/schema.ts`) whose keys map to the existing status machine:
   - `student_directors` → `pending_student_directors`
   - `faculty` → `pending_faculty`
   Configuration chooses inclusion (at least one), display labels, the reviewer role (`director` | `faculty`), and optional notification recipients. Transitions remain code-enforced.
2. **Append-only versions.** `WorkflowDefinition` rows are immutable once created; publishing creates `version = max + 1`. Requests pin their governing version at verification time via nullable `AccessRequest.workflowVersionId` / `requestTypeKey`. Unpinned (legacy) requests resolve to the active default — which matches what governed them originally.
3. **Behavior-preserving seed.** Migration seeds request type `standard_access` with workflow v1 exactly matching today's two-stage chain and labels ("Pending Directors", "Pending Faculty").
4. **Transition rules generalize as follows** while preserving current behavior for the seeded shape:
   - Acknowledge acts on a non-final review stage of the pinned workflow and advances to the next stage's status.
   - Approve requires the final review stage of the pinned workflow.
   - The legacy handoff conveniences (send-to-faculty, notify-faculty, return-to-faculty, move-back, undo-notify-faculty) require the exact directors→faculty shape and return 409 otherwise.
5. **Stage-role enforcement.** Acting on a stage (acknowledge, approve, reject under review) requires holding that stage's configured reviewer role or being a system administrator (see ADR-0003).
6. Recipient configuration on stages is additive: `null` keeps resolving recipients through the existing SystemSettings/email-config legacy path so nothing changes until operators populate routing.

## Consequences

- In-flight governance can never change when a new version is published; auditors can reconstruct which workflow applied to any historical request from its pin.
- Single-stage configurations are valid; approve then accepts the single final stage directly, and acknowledge returns 409 (no preparatory stage exists).
- Full field-level request-type policy and arbitrary multi-stage chains remain future work by design.

## Alternatives considered

- Mutating a single workflow row in place: rejected — silently changes requirements for pending requests.
- Generic BPM-style engine with dynamic statuses: rejected for this iteration — breaks UI filters, reporting, and compatibility contracts for little operator value today.
