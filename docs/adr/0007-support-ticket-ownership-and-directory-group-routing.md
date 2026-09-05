# ADR-0007: Support ticket ownership, assignment, and directory-group routing

Status: Accepted

## Context

Support tickets currently notify exactly one shared mailbox (`SystemSettings.adminEmail`, env fallback `ADMIN_EMAIL`) at creation; the creator receives nothing. `SupportTicket` has no ownership concept, so responsibility for a ticket is implicit and notifications cannot follow the people actually responsible.

The desired behavior (roadmap §13):

1. The creator receives a receipt ("we received your ticket; updates will follow").
2. Unassigned tickets notify the configured default queue so today's shared-mailbox behavior survives unchanged as the zero-configuration default.
3. Administrators assign one or more owners to a ticket — individual users or approved AD groups. Assignment is persisted data, not merely an email destination.
4. Once a ticket has active assignments, notifications route to the assignees instead of the shared mailbox.
5. A ticket may be created "on behalf of" an AD group. The selectable groups come from application configuration backed by directory snapshots — ordinary form rendering never performs live LDAP searches (roadmap §10). AD/LDAP remains the source of truth for membership and email addresses.

## Decision

**Directory-group allowlists.** `AllowedTicketSubjectGroup` rows are administrator-approved AD groups with two independent flags: `canBeRequestedFor` (ticket creators may file on behalf of the group) and `canBeAssignee` (the group may own tickets). Only rows that exist in this table can be used in either role; knowing a DN grants nothing.

**Snapshots, not live lookups, for selection.** `DirectorySyncRun` + `DirectoryGroupMemberSnapshot` capture membership and mail attributes for every active allowed group via the existing service-account LDAP integration (`resolveLDAPGroupMembersFromClient`). Sync runs are triggered by cron (`CRON_SECRET` bearer, same guarded scheduler pattern as offboarding/password expiration) or manually by an authorized admin. Each run records per-group outcomes including partial failures; a failed group keeps its previous snapshot rather than being wiped.

**Assignment is data with history.** `SupportTicketAssignment` rows reference either a user username or an approved group DN; only one active assignment row per target per ticket is meaningful and deactivation preserves the row. Every assign/unassign/reassign appends an immutable `TicketAssignmentHistory` entry. Assignment APIs stay behind the strict system-administrator gate (ADR-0006 scope discipline); they do not open new surfaces to mapped reviewers yet.

**Operator-facing ownership vocabulary.** The ticket requester and support staff are the two baseline owners shown in the interface because the requester can mutate their own ticket and authorized staff can administer the queue. Assignment rows add owners; they do not replace or visually hide those baseline principals. Notification routing still follows the recipient precedence below, so the ownership display must not be mistaken for a promise that every staff member receives every message.

**Recipient resolution precedence.** `lib/support/routing.ts` resolves notification recipients for a ticket:

1. Active assignments → for a group target, prefer its stored `mail` attribute when present (mail-enabled distribution), otherwise expand members from the latest snapshot (enabled accounts with valid emails).
2. If no active assignments exist, or the owner set resolves to zero usable addresses (for example every member lost their mailbox), the default queue (`adminEmail`, current precedence chain) receives the event so notifications never silently vanish.

The shared mailbox receives creation events only while a ticket is unowned. Assignee notification failures never fail ticket operations; delivery outcomes are logged. Deactivating a group in the allowlist does not silently strip its existing assignments or stop its notifications until an operator explicitly unassigns it - ownership changes are always deliberate and audited.

**Assignee access.** Membership in an assigned group (checked against the latest valid snapshot) grants view/respond/close on that specific ticket without full admin rights - including the same status transitions the creator has (open/in-progress/closed); a direct user assignment matches the assigned username exactly, case-insensitively. Freshness rule: snapshots within 24 hours are authoritative and no directory call is made; a stale snapshot is never trusted silently - it triggers one live LDAP membership check (single lookup covering all stale groups) using the same canonical DN comparison as the domain-admin boundary, and any directory failure fails closed. List views use fresh snapshots of active groups only (no per-user live lookups); detail and mutation paths apply the live-fallback rule and intentionally keep working for deactivated groups until an operator explicitly unassigns them, so visibility in the queue list can end before direct access does. Creator notifications fire when an assignee-group member responds.

**Permissions.** The catalog gains `tickets.assign` and `tickets.configure`. Existing ticket surfaces keep their current authorization; no behavior changes until configuration exists.

## Consequences

- First deployment behaves identically: no allowed groups exist (form shows self-only), no assignments exist (queue notified), receipt email is the only visible addition.
- Stale snapshots can misroute mail or access briefly between syncs; operators observe `lastSyncedAt`/run status in System Configuration and can trigger sync immediately.
- Group member expansion is bounded by what LDAP returns; very large groups produce large recipient lists by design (mail-enabled groups avoid expansion).
- Legacy `ADMIN_EMAIL` remains the queue fallback until persisted routing configuration replaces it (ADR-0005 precedence).

## Alternatives considered

- Emailing only the shared inbox forever: rejected — ownership must be explicit and auditable (roadmap §13).
- Live LDAP search during ticket-form render: rejected — page renders become latency- and availability-coupled to the domain controller (roadmap §10).
- Single "assignee" column on SupportTicket: rejected — multi-owner and group ownership need history and deactivation semantics, not overwrite semantics.
