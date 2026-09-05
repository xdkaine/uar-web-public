# UAR Portal Modularity, Configuration, and Integration Roadmap

Status: Draft architecture and implementation roadmap
Implementation status: Implemented on this branch through ADR-0015: capability registry and VPN decoupling behind ADR-0001; configurable review workflows and reviewer roles (Phase 5 constrained core, Phase 4 stage enforcement) behind ADR-0002/0003; operational copy templates behind ADR-0004; service-account secret configuration and distinct reviewer identities behind ADR-0005/0006; support ownership, assignment, and directory-group routing behind ADR-0007; workflow automation carried by visual workflow graphs (ADR-0008 superseded by ADR-0013); auth-service separation Stage 1 and local break-glass accounts behind ADR-0009 with its Stage 2 superseded by ADR-0012; ticket evidence uploads and the internal asset store behind ADR-0010; granular privilege tab/action gating behind ADR-0011; the standalone OIDC authentication service behind ADR-0012; visual workflow graphs over an expanded curated catalog behind ADR-0013; IdP session control plane behind ADR-0014; privilege-first RBAC behind ADR-0015. Remaining phases without an accepted ADR are not started.
Audience: Primary implementation agent, architecture reviewer, identity-governance reviewer, lifecycle-operations reviewer
Scope: `xdkaine/uar-web` application architecture, system configuration, access-request governance, identity/AD integration, support tickets, communications, Discord integration, password self-service, navigation/content configuration, auditing, audit evidence/ITGC/ITAC walkthroughs, control design/effectiveness evidence, and deployment evolution

## 1. Purpose

The UAR Portal has grown from a focused User Access Request workflow into an application that also owns Active Directory operations, VPN tracking, support tickets, account lifecycle actions, offboarding, communications, synchronization, sessions, password operations, and administrative tooling.

The next architecture should make those responsibilities explicit and configurable without turning the application into an unsafe generic workflow engine or breaking the environment that exists today.

The central goal is:

> Keep the current production behavior working on the first deployment of the refactor, then move functionality behind stable module, configuration, workflow, integration, and authorization boundaries so individual capabilities can be changed or deprecated gradually.

A second first-class goal is **auditability by design**. UAR should be able to withstand IT walkthroughs and support ITGC/ITAC testing without relying on ad-hoc screenshots, manual reconstruction, or excessively noisy logs. The system should preserve enough structured, versioned evidence to demonstrate how a control was designed at a point in time, how it operated for selected samples, who changed the design, what testing was performed, and whether exceptions occurred.

This is a compatibility-first refactor. It is not a rewrite and it is not permission to remove existing data, routes, workflows, or security controls in one release.

## 2. Mandatory Compatibility Contract

Every phase in this roadmap must obey the following rules unless a later, separately approved migration intentionally changes one of them.

1. **The first deployment after each structural refactor must preserve current user-visible behavior by default.** Existing installations must not require an administrator to manually recreate configuration before the portal works.
2. **All current modules begin enabled.** A newly introduced capability/module registry must seed or resolve the current environment to the behavior it has today.
3. **Database changes are additive first.** New tables/columns should initially be nullable or safely backfilled. Do not drop legacy fields in the same release that introduces their replacement.
4. **Existing data is preserved.** Disabling VPN Management, for example, must not delete `VPNAccount`, import, status, audit, request, or lifecycle records.
5. **Existing public and admin routes remain compatible during migration.** Internal implementation can be moved behind services/adapters before endpoints are renamed or removed.
6. **Configuration migrations use compatibility fallbacks.** Where configuration currently comes from `.env` or hard-coded behavior, use a staged precedence such as new persisted configuration -> existing environment fallback -> current safe code default until migration is complete.
7. **Legacy and new workflow representations coexist during migration.** Existing `AccessRequest.status` values must remain understandable while the workflow engine is introduced. In-flight requests must not silently change approval requirements.
8. **Published configuration is versioned.** New workflow, request-type, template, navigation, and similar configuration changes must not retroactively alter already-running requests or already-generated historical evidence.
9. **Security boundaries are not ordinary toggles.** CSRF, Turnstile where required, rate limiting, token hashing, TLS verification, secure cookie policy, secret redaction, authorization checks, and security-relevant auditability cannot be disabled merely for convenience.
10. **External side effects remain explicit and recoverable.** LDAP, VPN, SMTP, Discord, Redis, and database operations are not one atomic transaction. Preserve ordering, idempotency, partial-failure state, retries, and reconciliation.
11. **No destructive migration shortcuts.** Follow repository policy for checked-in Prisma migrations. Do not use destructive reset or `prisma db push` as a substitute for migration design.
12. **Deprecation happens only after consumers have moved.** Mark old settings/routes/fields as legacy, observe usage, migrate callers, and remove them only in a later cleanup change.
13. **Historical evidence remains interpretable.** A refactor must not make an old request, approval, role decision, configuration change, or external-side-effect record impossible to understand later.
14. **Evidence references immutable versions/snapshots.** When a control depends on mutable configuration, the transaction/evidence record must identify the workflow, role mapping, configuration, template, policy, or other version that actually applied at the time.

A useful implementation technique for risky decision logic is **shadow evaluation**: resolve the new configuration/workflow decision without applying it, compare it to legacy behavior in tests or controlled diagnostics, then switch the source of truth only after parity is demonstrated.

## 3. Current-State Evidence and Primary Coupling

The implementation agent must re-read `AGENTS.md`, `CONTEXT-MAP.md`, and every affected context before changing code. This roadmap does not replace those rules.

Important current paths include:

- `my-app/prisma/schema.prisma`
- `my-app/components/admin/SystemSettingsTab.tsx`
- `my-app/app/api/admin/settings/route.ts`
- `my-app/app/api/request/route.ts`
- `my-app/app/api/verify/confirm/route.ts`
- `my-app/app/api/admin/requests/[id]/acknowledge/route.ts`
- `my-app/app/api/admin/requests/[id]/approve/route.ts`
- `my-app/lib/adminAuth.ts`
- `my-app/lib/ldap/`
- `my-app/lib/email.ts`
- `my-app/lib/email-config.ts`
- `my-app/app/api/support/tickets/route.ts`
- `my-app/lib/password.ts`
- `my-app/app/api/auth/request-password-reset/route.ts`
- `my-app/app/api/auth/reset-password/route.ts`
- `my-app/app/api/auth/complete-required-password-change/route.ts`
- `my-app/components/Navbar.tsx`
- `my-app/lib/audit-log.ts`
- `my-app/lib/action-history.ts`
- `my-app/hooks/useAdminPageTracking.ts`
- `my-app/app/admin/page.tsx`
- `docker-compose.yml`

### 3.1 VPN is currently coupled to access-request governance

The Director acknowledgement path does more than advance governance state. It also creates/updates VPN tracking records and sends VPN/faculty-oriented notifications. Approval later activates VPN state as part of completing an access request.

That means VPN cannot safely be disabled by only hiding a tab. The first modularity work must separate:

- governance transition,
- Active Directory provisioning,
- optional VPN tracking/provisioning,
- notification delivery.

### 3.2 Configuration currently has multiple sources of truth

Current behavior is split across:

- database `SystemSettings`,
- `.env` values,
- hard-coded workflow/status behavior,
- hard-coded HTML/email content,
- static navigation,
- code-level role assumptions.

The target architecture must distinguish ordinary organization policy from secrets, bootstrap configuration, runtime feature availability, and immutable security behavior.

### 3.3 Authorization is currently too flat

The application currently relies heavily on `isAdmin` plus live LDAP administrator-group checks. Preserve the important live directory validation principle, but replace flat application privilege with roles and permissions so Director, Faculty, Support, Lifecycle, Communications, Auditor, and System Administrator responsibilities are distinguishable.

### 3.4 Audit logging is likely noisier than necessary, while audit evidence is not yet a first-class model

The current admin authorization helper writes a generic `ADMIN_API_REQUEST` audit event for protected admin API requests. The admin UI also emits page-view tracking, while Action History aggregates `AuditLog` records and several derived domain-history sources.

The refactor must verify what evidence is actually required for security/governance and reduce routine read/navigation noise without weakening accountability for meaningful actions.

A durable audit log alone is not sufficient for an IT walkthrough. UAR also needs a way to explain the control design that applied to a transaction, produce a complete population, select or import samples, correlate supporting records, preserve change evidence, and present the result in an auditor-friendly format.

### 3.5 Password validation can drift from Active Directory

`my-app/lib/password.ts` currently applies a local rule set, including minimum length and character-class checks, before AD performs the real password operation. AD remains the final authority and may apply domain or fine-grained password policy that differs from the portal's assumptions.

The UI and server should obtain an effective policy representation from a central directory-policy service where possible and treat AD's final decision as authoritative.

## 4. Target Architecture

The application should evolve toward the following layers.

### 4.1 Core Platform

Always-available application foundations:

- authentication/session enforcement,
- authorization/RBAC,
- configuration resolution,
- capability/module registry,
- audit event service,
- secret references,
- health/status reporting,
- migration/version handling.

### 4.2 Identity and Directory Integration

Owns:

- LDAP/Active Directory connection configuration,
- authentication,
- group and user lookup,
- application-role group mapping,
- password policy discovery,
- provisioning operations,
- directory snapshots/synchronization.

### 4.3 Governance Engine

Owns:

- Request Types,
- configurable request fields from a supported catalog,
- versioned approval workflows,
- reviewer requirements,
- workflow/stage instances,
- decisions and evidence.

### 4.4 Operational Capabilities

Examples:

- VPN Management,
- Support Tickets,
- Batch Accounts,
- Account Lifecycle,
- Infrastructure Sync,
- Offboarding,
- Communications,
- Events,
- Password Expiration.

### 4.5 Messaging and Content

Owns:

- email templates,
- copy/paste operational messages,
- portal content blocks,
- notification rendering,
- WYSIWYG editing,
- template versioning and preview,
- recipient resolution.

### 4.6 External Collaboration Integrations

Initially Discord, with room for future connectors. Owns:

- OAuth/account linking,
- outbound webhooks,
- inbound signed interactions,
- bot/application-command ticket creation,
- channel/team routing,
- external-message correlation.

### 4.7 Audit, Control, and Evidence Platform

Owns the read-oriented structures required to support ITGC/ITAC walkthroughs and audit testing without becoming a separate generic GRC platform.

Responsibilities include:

- control library and control versions,
- control-to-system/workflow/permission mappings,
- Test of Design evidence,
- Test of Operating Effectiveness evidence,
- complete population reporting,
- sample tracking,
- evidence packages/manifests,
- screenshot/print-friendly evidence views,
- configuration/change evidence,
- Segregation-of-Duties and exception reporting,
- control assertions and automated-test mappings,
- auditor/read-only access.

The underlying security/governance audit trail remains a core platform responsibility and cannot be disabled simply because the evidence UI/module is not in use.

### 4.8 Infrastructure

Owns deployment contracts for:

- application replicas,
- PostgreSQL,
- Redis,
- schedulers/workers,
- secret management,
- backups/recovery,
- health checks and migration execution.

## 5. Capability / Module Registry

Do not scatter `if (settings.vpnEnabled)` checks throughout the codebase.

Create a centralized capability registry with known capability identifiers defined in code and runtime state stored/configured centrally.

Suggested initial capabilities:

| Capability | Purpose | Typical dependencies |
| --- | --- | --- |
| `identity.core` | Login, session, core identity | Database, directory auth |
| `directory.provisioning` | AD account mutations | Directory integration |
| `vpn.management` | VPN tracking/import/operations | Directory integration |
| `support.tickets` | Portal support workflow | Identity |
| `batch.accounts` | Bulk account work | Directory provisioning |
| `account.lifecycle` | Enable/disable/revoke/restore | Directory provisioning; VPN optional |
| `infrastructure.sync` | Reconciliation | Directory; VPN optional |
| `communications` | Mass/operational communications | SMTP |
| `offboarding` | Campaign offboarding | Lifecycle |
| `password.expiration` | Expiration monitoring | Directory |
| `events` | Event-based access requests | Access Requests |
| `integrations.discord` | Discord linking/ticket bridge | Discord integration config |
| `content.management` | Managed page/template content | Core configuration |
| `audit.evidence` | Evidence Center, walkthroughs, populations, audit packages | Core audit/configuration/history data |

Capability states should distinguish at least:

- `enabled`,
- `disabled`,
- `unavailable` / misconfigured.

The registry must be consumed by:

- navigation,
- API guards,
- background workers,
- request/workflow validation,
- health UI,
- dependency validation.

### VPN-disabled acceptance behavior

When `vpn.management` is disabled:

- VPN operational navigation is hidden for ordinary administrators.
- VPN mutation APIs return a consistent module-disabled response.
- VPN imports and workers do not run.
- historical VPN data remains intact.
- AD-only access requests still complete successfully.
- lifecycle/sync actions explicitly skip VPN work when appropriate and record a meaningful result.
- configuration that requires VPN cannot be newly published while VPN is disabled.
- no unrelated request fails because a VPN record was not created.

A read-only historical VPN-data view may remain available to appropriately privileged users even when operational VPN management is disabled.

## 6. System Settings -> System Configuration

Replace the concept of one growing System Settings screen with a System Configuration area composed of bounded sections.

Suggested sections:

1. **Overview & Health**
   - capability state,
   - directory connectivity,
   - SMTP connectivity,
   - Discord connectivity,
   - scheduler/worker health,
   - migration/configuration warnings.

2. **Modules**
   - enabled/disabled state,
   - dependency graph,
   - impact preview before disabling.

3. **Access Requests**
   - Request Types,
   - field requirements,
   - workflow selection,
   - provisioning requirements.

4. **Directory & Identity**
   - LDAP URL,
   - search bases/domain,
   - approved/provisioning groups,
   - group synchronization,
   - service credential reference,
   - Test Connection.

5. **Roles & Permissions**
   - roles,
   - permissions,
   - AD group mappings,
   - direct exceptions where allowed.

6. **Email, Templates & Content**
   - sender identity,
   - operational recipients,
   - WYSIWYG templates,
   - page content blocks,
   - preview/test send.

7. **Support & Routing**
   - support teams,
   - default queue/shared mailbox,
   - routing rules,
   - assignment policy,
   - allowed "requested for" directory groups.

8. **Discord**
   - integration enabled state,
   - bot/application credential reference,
   - OAuth configuration,
   - guild/channel allowlist,
   - ticket routing,
   - notification settings.

9. **Navigation & Pages**
   - navbar items,
   - order,
   - labels,
   - audiences/permissions,
   - capability requirements,
   - managed page content.

10. **Password & Self-Service**
    - effective AD policy display,
    - self-service options,
    - reset behavior,
    - reset link lifetime/operational settings where safe.

11. **Audit, Evidence & Retention**
    - event classes/retention,
    - telemetry settings,
    - protected event classes that cannot be disabled,
    - Control Library,
    - evidence-package defaults,
    - population definitions,
    - export policy,
    - evidence retention and integrity settings.

12. **Security & Recovery**
    - login controls,
    - protected break-glass procedures,
    - security posture status.

13. **Change Governance**
    - configuration change risk classification,
    - optional/required review and approval rules,
    - test plan/result fields,
    - rollback/forward-recovery plan,
    - linked issue/change reference,
    - implementation and verification state.

14. **Configuration History**
    - actor,
    - timestamp,
    - previous/new version,
    - reason,
    - publish/rollback information,
    - linked change record/evidence package.

## 7. Configuration Source-of-Truth Rules

The objective is not to eliminate environment variables. It is to stop treating deployment secrets, organization policy, and user-editable settings as the same thing.

### Move toward persisted configuration

Suitable for database-backed configuration:

- module states,
- access-request workflows,
- request field policy,
- application role definitions/mappings,
- directory non-secret metadata,
- email recipients,
- email/template content,
- ticket routing/teams,
- Discord channel/routing metadata,
- navbar configuration,
- managed page content,
- operational URLs/labels,
- telemetry retention preferences within protected limits.

Configuration that affects a control design must be versioned in a way that lets the evidence layer determine what configuration was effective for a historical transaction or audit period.

### Keep outside ordinary database configuration

Keep bootstrap secrets in deployment secret storage or a dedicated secret manager:

- `DATABASE_URL` / DB credentials,
- database encryption bootstrap keys,
- session/CSRF/auth cryptographic secrets,
- Redis credentials,
- Turnstile secret,
- cron authentication secret,
- secret-manager bootstrap credentials.

LDAP bind passwords, SMTP passwords, and Discord bot/application secrets may eventually be represented by **secret references** in configuration, but must not become ordinary plaintext settings.

### Migration precedence

During migration, use compatibility resolution where appropriate:

`persisted configuration -> existing environment fallback -> current safe default`

Expose the resolved source in System Configuration so operators know whether a value is still coming from legacy `.env` fallback. Do not expose secret values.

Later releases can warn on legacy fallback use before removing individual environment variables.

## 8. Configurable Access Request Governance

Do not implement a fully generic arbitrary workflow engine in the first iteration. Implement a constrained UAR governance model.

Suggested models/concepts:

- `RequestType`
- `RequestTypeVersion`
- `ApprovalWorkflow`
- `ApprovalWorkflowVersion`
- `ApprovalStage`
- `WorkflowInstance`
- `StageInstance`
- `ReviewDecision`

The current behavior should be seeded as the first published workflow:

`Email Verification -> Student Director Review -> Faculty Review -> Provisioning -> Approved`

### Approval stage configuration

A stage should support controlled properties such as:

- unique stable key,
- display name,
- reviewer role/team,
- order,
- approval requirement (`any`, `all`, `quorum` where justified),
- supported conditions,
- optional instructions/template key.

Example future workflows:

- Internal standard access: Director only.
- External access: Director + Faculty.
- Privileged infrastructure access: Director + Faculty + System Administrator.
- Event access: Event Coordinator/Director + optional Faculty.

### Field configuration

Use a supported field catalog rather than database-stored executable expressions.

Potential configurable fields:

- Name,
- Email,
- Institution,
- Event,
- Reason,
- Account Expiration,
- Domain Account requirement,
- requested services/capabilities,
- optional comments/justification.

For each Request Type, configuration can set supported fields to hidden/optional/required and define labels/help text where safe.

Security invariants such as anti-enumeration, email verification integrity, token handling, rate limiting, and server-side authorization remain code-enforced.

### Versioning rule

Every request must retain the Request Type and workflow version under which it was submitted. Editing a workflow tomorrow cannot silently add/remove an approval from a request already under review today.

### Governance evidence contract

Every material request transition should retain or be reconstructable with:

- actor and actor type,
- actor role/permission context,
- workflow/stage version,
- previous state and resulting state,
- decision/justification where applicable,
- timestamp,
- correlation ID,
- external provisioning result(s),
- exception/override indicator,
- linked configuration/control version where relevant.

This evidence contract should be designed once and reused by the Audit & Evidence capability rather than rebuilt ad hoc in reporting code.

## 9. Roles and Permissions

Replace flat application administrator access with RBAC while preserving live directory-backed validation for privileged roles.

Suggested initial roles:

- System Administrator
- Director
- Faculty
- Support Agent
- Lifecycle Operator
- Communications Operator
- Auditor
- User

Suggested permission examples:

- `settings.manage`
- `modules.manage`
- `roles.manage`
- `directory.configure`
- `access_requests.read`
- `access_requests.review.director`
- `access_requests.review.faculty`
- `access_requests.approve`
- `tickets.read`
- `tickets.assign`
- `tickets.respond`
- `vpn.manage`
- `lifecycle.execute`
- `communications.manage`
- `audit.read`
- `audit.export`
- `controls.read`
- `evidence.generate`
- `populations.export`
- `audit.samples.manage`
- `changes.read`

Roles receive permissions. Users receive roles through approved directory-group mappings and, only where justified, explicit application assignments.

Do not treat an LDAP bind/service account as a human application role. Integration credentials and user authorization identities are separate concepts.

The Auditor role should remain read-only by default. It may be able to generate evidence, save a population definition, or manage an audit sample without receiving operational permissions to approve access, change configuration, reveal credentials, or mutate directory/VPN state.

### Compatibility migration

Seed the current LDAP administrator-group behavior to System Administrator so existing admins continue to have the same effective access immediately after migration.

Then introduce Director and Faculty mappings without removing existing access until the mappings are validated.

## 10. Directory Integration and Local Directory Snapshots

Create a first-class directory integration configuration/service.

It should support:

- connection metadata,
- health tests,
- search base/domain metadata,
- role/group mappings,
- provisioning target groups/OUs,
- read vs provisioning capability distinction,
- secret references,
- last successful operation/health status.

### Avoid unnecessary live LDAP calls in ordinary UI flows

For selectors such as "create ticket for an AD group," periodically or administratively synchronize approved directory group metadata into PostgreSQL.

Suggested concepts:

- `DirectoryGroupSnapshot`
- `DirectoryGroupMemberSnapshot` where membership caching is needed
- `DirectorySyncRun`
- `AllowedTicketSubjectGroup`

The user-facing form should read the local snapshot, not perform an LDAP search on every page render.

Authorization-sensitive operations must still validate against current-enough/live directory state according to the security boundary.

Directory snapshots that influence authorization, role mapping, populations, or evidence should include synchronization timestamps/source metadata so an auditor can distinguish current directory state from the state that supported a historical conclusion.

## 11. HTML, Email, WYSIWYG, and Managed Content

Any organization-owned HTML/text content that currently requires a code deployment should be evaluated for migration to managed, versioned content.

This includes more than email.

Candidate configurable content:

- verification emails,
- faculty notifications,
- Director notifications,
- approval/rejection emails,
- account activation emails,
- password-reset emails,
- ticket received/assigned/replied/closed emails,
- offboarding/reminder emails,
- copy/paste faculty handoff messages,
- login/request help text,
- landing page notices/sections,
- service descriptions,
- managed informational pages.

### WYSIWYG requirements

Provide a WYSIWYG editor for HTML-capable templates/content, but do not permit arbitrary unsafe HTML execution.

Requirements:

- sanitize rendered HTML server-side with an allowlist,
- reject scripts, event-handler attributes, unsafe embeds, and dangerous URLs,
- use an approved placeholder/merge-variable schema,
- preview desktop/mobile rendering,
- preview with sample variables,
- maintain plain-text fallback for emails,
- provide Test Send for email templates,
- version drafts and published templates,
- allow rollback to a prior published version,
- record configuration-change audit events,
- prevent templates from directly invoking application logic.

Suggested model:

- `ContentTemplate`
  - stable key,
  - type (`email`, `message`, `page_block`, etc.),
  - subject where applicable,
  - HTML,
  - text fallback,
  - allowed variable schema,
  - version/status,
  - createdBy/publishedBy/timestamps.

Seed the first published versions from the **exact current content** so the first deployment produces equivalent messages.

A historical evidence view should be able to identify the template version used for a notification without needing to store sensitive rendered content unnecessarily.

## 12. Configurable Navbar and Page Registry

`Navbar.tsx` currently contains static links and service URLs. Introduce a managed navigation registry rather than letting administrators edit React markup.

Suggested navigation configuration fields:

- stable key,
- label,
- destination,
- internal vs external,
- order,
- parent/dropdown group,
- icon key from an approved catalog,
- visibility (`public`, `authenticated`, role/permission based),
- required capability,
- open-in-new-tab,
- enabled state.

Examples that become configurable:

- Home
- Internal Request
- External Request
- Services dropdown
- Kamino/Proxmox/Uma external links
- Discord link
- Support

System-required safety navigation such as login/logout/profile/recovery paths should have protected behavior and should not be removable in a way that makes the portal unrecoverable.

### Page settings/content

Do not build arbitrary dynamic code pages. Instead introduce a Page Registry plus managed content blocks for approved surfaces.

Configuration may control:

- page title,
- subtitle/help text,
- visibility,
- content blocks,
- WYSIWYG informational content,
- capability/permission requirement.

Application routes and business behavior stay in code.

## 13. Support Ticket Ownership, Teams, and Routing

Evolve support from "create ticket and notify one admin mailbox" to explicit ownership.

Suggested models/concepts:

- `SupportTeam`
- `SupportTeamMember`
- `TicketAssignment`
- `TicketAssignmentHistory`
- `TicketRoutingRule`
- `TicketParticipant`
- `TicketExternalLink`
- `TicketOrigin`

### Target ticket behavior

#### Creation

1. Create ticket and durable status/audit evidence.
2. Send requester a receipt: "We received your ticket and will send updates."
3. If no assignment exists, notify the configured unassigned/default queue (initially compatible with the existing shared mailbox such as `soc@cpp.edu`).

#### Assignment

A privileged operator can assign:

- one person,
- multiple people,
- a support team.

Assignment must be data, not merely an email destination.

#### After assignment

- User replies notify active assignees/team according to routing policy.
- The shared mailbox does not receive every event unless it remains a participant by policy.
- Staff replies notify the requester and configured participants.
- Reassignment preserves history and notifies the new owner set.

#### Requested-for scope

A ticket may be created for:

- self,
- an allowed local directory-group snapshot,
- another allowed subject type introduced later.

Authorization must prevent users from creating tickets on behalf of arbitrary directory groups merely because they know a DN/name.

## 14. Discord Integration

Implement Discord as an optional integration capability in phases. Do not begin with full bidirectional message mirroring.

### Phase A: Outbound Discord notifications

Support configured Discord webhook notifications for selected events such as:

- new unassigned ticket,
- ticket assignment,
- critical/high-severity ticket,
- lifecycle/operator alert if explicitly configured.

Requirements:

- allowlisted events,
- configurable destination mapping,
- secret webhook URL stored as a secret/reference,
- no unnecessary PII or credentials in Discord messages,
- delivery result recorded without treating Discord failure as ticket creation failure.

### Phase B: Link UAR user to Discord identity

Use Discord OAuth2 rather than asking users to type an arbitrary Discord username.

Suggested model:

- `ExternalIdentityLink`
  - provider (`discord`),
  - provider user ID,
  - UAR username/user identity,
  - display metadata,
  - linkedAt,
  - verifiedAt,
  - revokedAt.

Requirements:

- state/CSRF protection,
- user-visible unlink/revoke,
- unique provider identity mapping,
- audit link/unlink actions,
- do not use mutable Discord display names as identity keys.

### Phase C: Create ticket from Discord

Use a Discord application/bot interaction endpoint with Discord signature verification. Do not accept an unauthenticated generic HTTP webhook as a ticket-creation authority.

A `/ticket` command or modal can:

1. identify the Discord user,
2. resolve their verified UAR external-identity link,
3. collect subject/category/body,
4. create the same `SupportTicket` domain object used by the portal,
5. mark origin as Discord,
6. return a ticket identifier/status to the user.

Unlinked Discord users should receive a link/instruction to connect their account in UAR before privileged ticket operations are permitted.

### Phase D: Controlled Discord ticket conversation bridge

If later desired, map a UAR ticket to a Discord thread/channel/DM conversation.

Use idempotent external message IDs and explicit direction/origin fields to prevent loops and duplicates.

Do not automatically mirror sensitive ticket content into public channels. Channel/guild allowlists and privacy classifications must be part of configuration.

## 15. Password Policy and Self-Service Redesign

Active Directory is the final authority for password acceptance. The portal should provide accurate guidance and safe self-service without pretending its local regex is the authoritative policy.

### 15.1 Central Password Policy Provider

Create a server-side directory password-policy service that attempts to resolve the effective policy relevant to the user.

Where supported, investigate:

- domain password policy,
- minimum password length,
- password history,
- password age information relevant to UX,
- complexity flags,
- fine-grained password policies / resultant PSO for the user.

The exact implementation must be validated against the AD environment and LDAP permissions. Do not assume the domain default is always the user's effective policy.

Expose only safe policy metadata to the frontend.

### 15.2 One policy contract for all password UIs

Account activation, required password change, authenticated password change, and reset-password pages should consume the same safe password-policy endpoint/schema.

The UI should display the effective known requirements. Server-side code should perform the same pre-validation where possible.

AD still performs the final password operation. Map common AD constraint failures into useful, non-sensitive user messages.

If effective policy cannot be queried, show conservative guidance and state that the directory performs final validation rather than inventing requirements that may be wrong.

### 15.3 Authenticated self-service password change

Users should not need to file a support/reset request merely to change their own password.

Add an authenticated **Change Password** action in Profile/Account settings.

Preferred security flow:

- require the current password or a sufficiently recent re-authentication,
- apply rate limiting,
- fetch/display effective policy,
- submit through a dedicated server-side password-change operation,
- revoke/rotate sessions when policy requires,
- log the successful/failed security event without logging passwords.

### 15.4 Forgot-password reset remains separate

Keep a secure email reset-link flow for users who cannot authenticate.

Preserve:

- anti-enumeration behavior,
- hashed one-time tokens,
- expiry,
- replay prevention,
- rate limiting,
- rollback/retry safety if the AD mutation fails.

Review the current token-verification GET and reset error behavior for information-disclosure consistency as part of this redesign.

### 15.5 Admin-assisted reset

Administrators with an explicit permission may issue a reset link to a verified account instead of learning/setting a user's password. Prefer user-completed password selection over administrators handling credentials.

## 16. Audit Logging and Action Governance Redesign

The goal is not "log less" or "log everything." The goal is to log the events necessary to prove important actions, investigate security incidents, and understand cross-system outcomes without drowning those events in routine UI traffic.

### 16.1 Define an audit event taxonomy

Classify events into categories such as:

1. **Security-critical**
   - login success/failure classes where appropriate,
   - authorization denial,
   - role/permission change,
   - password reset/change,
   - session revocation,
   - external identity link/unlink,
   - break-glass actions.

2. **Governance / approval**
   - request submitted/verified,
   - stage advanced,
   - reviewer decision,
   - approval/rejection,
   - assignment/reassignment.

3. **External side effect / lifecycle**
   - AD create/enable/disable,
   - VPN mutation,
   - SMTP send outcome,
   - Discord send/interaction outcome,
   - offboarding action,
   - rollback/reconciliation.

4. **Configuration change**
   - module toggle,
   - workflow publish,
   - role mapping change,
   - integration change,
   - template publish,
   - navigation change.

5. **Sensitive read**
   - credential reveal,
   - protected export,
   - high-risk account/security detail access where governance requires it.

6. **Routine telemetry**
   - page view,
   - tab switch,
   - normal list refresh,
   - health polling.

Routine telemetry does not necessarily belong in the durable security audit table.

### 16.2 Remove generic duplicate noise carefully

Investigate replacing durable `ADMIN_API_REQUEST` logging on every admin API call with targeted events at meaningful action boundaries.

Do not remove denied-access/security evidence simply because the generic API log is noisy.

Page-view/tab tracking should normally be telemetry/analytics rather than immutable governance evidence unless a specific compliance requirement says otherwise.

### 16.3 Standardize audit event shape

Meaningful events should consistently contain, where applicable:

- stable action key,
- event class/kind,
- actor identity and actor type,
- actor role context where useful,
- target type/id,
- subject identity,
- related request/ticket/lifecycle IDs,
- outcome,
- correlation ID,
- external operation result,
- safe structured details,
- timestamp,
- source/origin.

Continue strict redaction. Never log passwords, reset/activation tokens, session tokens, secret values, authorization headers, or unnecessary directory structure/PII.

### 16.4 Action History is a read model, not another competing write log

Retain domain-specific history where it represents real domain state (request decisions, ticket status, lifecycle status, VPN status, etc.).

`ActionHistory` should aggregate/correlate those sources into a useful view rather than causing the application to write several duplicate events for one action just to make the UI convenient.

The same principle applies to the Evidence Center: it should correlate canonical evidence and domain state rather than create duplicate writes solely for presentation.

### 16.5 Retention

Allow retention configuration for telemetry and lower-risk event classes, but establish minimum/protected retention for security/governance records according to organizational requirements. An administrator should not be able to disable security logging globally from an ordinary settings switch.

## 17. Additional Configuration Candidates

As code is audited, actively look for organization-specific constants that should be configuration rather than code.

Examples:

- organization/portal display name,
- branding/logo references and favicon selection from managed assets,
- support contact information,
- external service links,
- request success/help text,
- internal email-domain policy where appropriate,
- default expiration choices,
- allowed ticket categories/severities,
- support teams and escalation rules,
- lifecycle reason catalogs,
- offboarding reminder text/timing where security permits,
- communications footers,
- directory group mappings,
- operational notification recipients,
- scheduler operational intervals where safe,
- default page/banner content.

Do not convert every constant into a database value. A value is a configuration candidate when it represents organization policy/content that operators reasonably need to change without a code release.

## 18. Data Model Direction

Exact Prisma design requires an architecture pass and migration review, but likely new bounded models include:

### Platform configuration

- `CapabilityState`
- `ConfigurationRevision` / domain-specific version tables
- `IntegrationConnection`
- `SecretReference` metadata only (not plaintext secret storage)

### Authorization

- `Role`
- `Permission`
- `RolePermission`
- `DirectoryRoleMapping`
- optional `UserRoleAssignment`

### Governance

- `RequestType`
- `RequestTypeVersion`
- `ApprovalWorkflow`
- `ApprovalWorkflowVersion`
- `ApprovalStage`
- `WorkflowInstance`
- `StageInstance`
- `ReviewDecision`

### Content

- `ContentTemplate`
- `ContentTemplateVersion`
- `NavigationItem`
- `ManagedPage` / `PageContentBlock`

### Support

- `SupportTeam`
- `SupportTeamMember`
- `TicketAssignment`
- `TicketAssignmentHistory`
- `TicketRoutingRule`
- `TicketParticipant`
- `TicketExternalLink`

### Directory

- `DirectoryGroupSnapshot`
- optional `DirectoryGroupMemberSnapshot`
- `DirectorySyncRun`
- `AllowedTicketSubjectGroup`

### External identity / Discord

- `ExternalIdentityLink`
- `ExternalInteractionReceipt` / idempotency record where needed

### Audit, controls, evidence, and change governance

Potential bounded concepts include:

- `Control`
- `ControlVersion`
- `ControlMapping`
- `ControlAssertion`
- `ControlAssertionRun`
- `EvidencePackage`
- `EvidenceItem`
- `EvidenceArtifact`
- `EvidenceManifest`
- `AuditPopulationDefinition`
- `AuditPopulationRun`
- `AuditSample`
- `ConfigurationChange`
- `ConfigurationChangeApproval`
- `ChangeTestResult`
- `ControlException`

Do not create all of these tables in one migration simply because they appear in this roadmap. The architecture phase should determine which concepts deserve persistent models and which are read models/materialized exports.

Use stable IDs and snapshot/version references so historical records remain interpretable after configuration changes.

## 19. Deployment and Data Resilience

The existing Compose stack includes PostgreSQL, Redis, the application, and scheduler containers. Breaking PostgreSQL onto a dedicated Proxmox VM is reasonable isolation, but it is not itself redundancy.

Prioritize in this order:

1. documented automated PostgreSQL backups,
2. off-host/off-cluster backup copy,
3. restore procedure and tested restore,
4. PITR/WAL strategy if recovery objectives justify it,
5. stateless application behavior,
6. multiple app replicas behind the reverse proxy/load balancer,
7. shared Redis suitable for distributed rate-limit/session-related state,
8. singleton/claimed scheduler semantics,
9. explicit one-time migration step per deploy,
10. optional PostgreSQL replication/failover when availability requirements justify it.

Application horizontal scaling must not cause every replica to independently execute the same scheduler/destructive job.

Evidence packages are not a substitute for database backup. Their purpose is audit support and reproducibility, not primary disaster recovery.

## 20. Implementation Roadmap

### Phase 0 - Baseline, ADRs, control inventory, and regression harness

Before structural changes:

- inventory `process.env` consumers,
- inventory VPN callers/dependencies,
- inventory hard-coded content and URLs,
- inventory audit event writers/readers,
- inventory password validation paths,
- document current Access Request state transitions,
- identify the initial ITGC/ITAC controls UAR is expected to support,
- map the current evidence available for those controls and identify gaps,
- identify current screenshot/manual evidence commonly needed in walkthroughs,
- add focused regression tests for current request, approval, ticket, password, and module behavior,
- write ADRs for capability boundaries, configuration/secrets, workflow versioning, RBAC, and audit/evidence architecture.

Use `architect` before implementation because this crosses identity, lifecycle, migration, evidence, and failure-semantics boundaries.

### Phase 1 - Capability framework, behavior unchanged

Implement:

- capability registry,
- persisted capability state,
- dependency validation,
- centralized route/service guards,
- capability-aware navigation helpers,
- capability health reporting,
- capability change audit events.

Seed all existing capabilities enabled. The release must behave like the current portal.

### Phase 2 - VPN decoupling

Refactor Access Request acknowledgement/approval and lifecycle/sync paths so VPN behavior is invoked through a capability/service boundary rather than being required side-effect logic.

Definition of done:

- VPN enabled = current behavior preserved,
- VPN disabled = AD-only flows still work,
- no VPN historical data is deleted,
- VPN APIs are guarded,
- background work handles disabled capability explicitly,
- workflows requiring VPN cannot be published while VPN is disabled,
- tests cover enabled/disabled/unavailable states.

### Phase 3 - Configuration platform

Introduce typed configuration services and the new System Configuration UI.

Migrate low-risk/current DB-or-env settings first:

- email sender/recipients,
- service links,
- non-secret directory metadata,
- operational labels.

Keep compatibility fallbacks and expose legacy-source warnings.

Introduce the first configuration revision/change-history primitives here so later configuration modules are versioned from the beginning. High-risk approval/test workflows can mature in the Audit & Evidence phase rather than blocking the initial compatibility refactor.

### Phase 4 - RBAC and directory mappings

Add roles/permissions and map existing admins to System Administrator behavior.

Then introduce Director and Faculty as distinct roles.

Replace page/API `isAdmin` assumptions incrementally with explicit permission checks while keeping legacy compatibility until each surface migrates.

### Phase 5 - Versioned Access Request workflows and Request Types

Seed current Director -> Faculty behavior exactly.

Add workflow instances for new requests while preserving legacy status compatibility.

Migrate field requirements to Request Type policy.

Do not change in-flight request governance when new workflow versions are published.

Capture enough workflow/version/decision metadata that a historical request can later be used as an operating-effectiveness sample without reconstructing today's configuration.

### Phase 6 - Content/template management and WYSIWYG

Create the rendering/sanitization/versioning layer.

Seed exact current email HTML/text as initial published versions.

Migrate emails in controlled batches with golden/snapshot tests to ensure rendered output remains functionally equivalent before operators edit templates.

Then add copy/paste operational messages and safe managed page content.

### Phase 7 - Support ownership and routing

Add:

- requester receipt,
- default unassigned queue,
- user/team multi-assignment,
- routing rules,
- participant notification resolution,
- directory-group requested-for snapshots.

Keep existing shared-mailbox behavior as the initial default routing configuration.

### Phase 8 - Password policy/self-service

Create Password Policy Provider and shared password-policy contract.

Migrate all password surfaces to it.

Add authenticated self-service Change Password.

Retain secure forgot-password and admin-issued reset-link paths.

Test AD final-rejection behavior and error mapping.

### Phase 9 - Navigation/page configuration

Move static service/navigation items into the managed registry while seeding the exact current menu and links.

Add page-level managed content only for approved content slots; do not make application logic editable as HTML.

### Phase 10 - Audit redesign

Measure current event volume and identify duplication.

Implement event taxonomy and centralized event policy.

Migrate meaningful writes/security events first.

Reduce/remove routine durable `ADMIN_API_REQUEST` and page-view noise only after tests prove meaningful action evidence remains.

Update Action History to correlate canonical audit and domain-history sources cleanly.

Define the stable evidence event/subject identifiers that the Evidence Center can rely on.

### Phase 11 - Audit & Evidence Center, control library, walkthroughs, and change governance

Implement this in bounded increments:

1. Control Library and control-to-system mappings.
2. Read-only Evidence Center for individual transactions.
3. Complete population definitions/exports and sample tracking.
4. Test of Design snapshots using versioned configuration.
5. Test of Operating Effectiveness evidence packages for selected samples.
6. Screenshot/print-friendly Walkthrough Mode.
7. Configuration Change records with before/after, approval, test, implementation, verification, and rollback evidence.
8. SoD/exception analysis.
9. Control assertions mapped to automated tests and production-health signals where justified.
10. Evidence manifests/integrity metadata and optional PDF/export packaging.

Do not require the full Evidence Center to exist before meaningful canonical audit events are improved. Build the underlying evidence quality first, then the presentation/reporting layer.

### Phase 12 - Discord integration

Implement in safe increments:

1. outbound webhooks,
2. Discord OAuth account linking,
3. signed Discord application-command/modal ticket creation,
4. optional controlled conversation bridging.

Every inbound operation must be authenticated, idempotent, and mapped to a UAR identity/permission context where required.

### Phase 13 - Remaining module sweep and infrastructure evolution

Apply capability/configuration patterns to:

- Batch Accounts,
- Lifecycle,
- Sync,
- Offboarding,
- Communications,
- Password Expiration,
- Events,
- Support.

Then address database separation/backups/replicas and application horizontal scaling.

## 21. Deprecation Strategy

Every replacement follows stages:

1. **Introduce** new model/service with no behavior change.
2. **Seed/backfill** from current state.
3. **Dual-read/shadow compare** where useful.
4. **Switch internal callers** to new service.
5. **Mark legacy source deprecated** in UI/docs/log diagnostics.
6. **Observe** for at least one controlled release/migration window.
7. **Remove legacy code/data only in a later explicit change.**

Examples:

- `FACULTY_EMAIL` remains fallback until persisted notification routing is proven.
- existing request status columns remain while workflow instances become authoritative.
- `isAdmin` may remain in session compatibility responses while server authorization moves to permissions.
- hard-coded email functions may call the new renderer using seeded templates before old inline HTML is removed.

Before removing a legacy field that is referenced by historical evidence, verify that the replacement data/version snapshot can reproduce the same conclusion for prior periods.

## 22. Testing and Validation Expectations

Each implementation phase must include focused tests and full relevant regression validation.

Required classes of tests include:

- module enabled/disabled/unavailable,
- permission allowed/denied,
- legacy configuration fallback,
- workflow version pinning,
- concurrent reviewer/action attempts,
- LDAP partial failure,
- SMTP failure/retry,
- Discord duplicate interaction replay,
- template sanitization/XSS prevention,
- unsafe URL/HTML rejection,
- password policy mismatch/AD rejection,
- password reset token replay/expiry,
- ticket reassignment notification resolution,
- audit-event presence for meaningful actions,
- absence/reduction of routine duplicate events where intentionally changed,
- migration/backfill correctness,
- historical evidence reproducibility after configuration changes,
- ToD snapshot uses the correct effective configuration version,
- population completeness and filter reproducibility,
- sample-to-population traceability,
- evidence manifest/integrity metadata,
- SoD/exception detection,
- Auditor role least privilege,
- change record before/after/test/approval evidence,
- control assertion failure and recovery behavior.

Follow repository validation policy. High-risk changes require the appropriate domain reviewer after implementation, and the primary agent must independently verify material reviewer findings.

## 23. Explicit Non-Goals / Guardrails

Do not turn UAR into:

- a generic arbitrary BPM engine,
- a generic CMS capable of executing arbitrary scripts,
- a secret manager implemented casually inside PostgreSQL,
- a Discord bot that can bypass portal identity/authorization,
- a system where administrators can disable security auditability,
- a UI that claims a password will be accepted when AD has not accepted it,
- a full enterprise GRC platform simply because UAR supports its own control evidence,
- a screenshot repository where images replace structured source evidence,
- a microservice rewrite merely for architectural purity.

Start with clear module/service boundaries inside the existing application. Extract deployment/services only when the operational benefit is justified.

## 24. First Agent Assignment

The recommended first implementation assignment is **Phase 0 + Phase 1 + the design portion of Phase 2**, not the entire roadmap in one PR.

The implementation agent should:

1. read repository guidance/contexts,
2. inventory capability and VPN coupling paths,
3. inventory current audit/evidence sources for the initial access-request control flow,
4. identify which current records are needed to reconstruct one complete access-request walkthrough,
5. produce/confirm ADRs,
6. add regression tests for current behavior,
7. implement the capability registry with every existing capability enabled,
8. wire navigation and server guards without changing behavior,
9. define the VPN service/capability interface and migration plan,
10. define but do not yet fully implement the canonical governance evidence contract,
11. stop before deleting/replacing legacy VPN data or changing production workflow behavior unless separately authorized.

The next bounded change can then move Access Request VPN side effects behind that interface and prove VPN-disabled AD-only operation.

## 25. End-State Success Criteria

This roadmap is successful when:

- a module such as VPN can be disabled without breaking unrelated capabilities or deleting history,
- Directors and Faculty are distinct configured governance roles,
- Access Request reviewer stages and supported field requirements are versioned configuration,
- organization-owned HTML/text content can be edited safely through WYSIWYG tooling and previewed/versioned,
- ticket ownership and notification routing follow actual assignees/teams,
- approved directory-group choices are served from synchronized local configuration data,
- users can securely link Discord identities and optionally create tickets through authenticated Discord interactions,
- password UX reflects effective directory policy while AD remains final authority,
- authenticated users can perform appropriate password self-service without filing a support request,
- navbar/service links and approved page content are configurable without editing React code,
- audit logs emphasize meaningful security/governance/external-side-effect evidence rather than routine refresh noise,
- an auditor can reproduce the design that applied to a historical transaction instead of seeing only today's configuration,
- a complete population can be generated with reproducible filters and sampled records can be traced back to that population,
- a selected access-request sample can be presented as a coherent evidence chain from submission through approval/provisioning,
- configuration/control changes have before/after, approver, test result, implementation, verification, and rollback evidence where policy requires it,
- SoD violations, overrides, and exceptions are visible rather than buried in generic logs,
- evidence views are screenshot/print friendly and contain environment/scope/timestamp/source metadata,
- current production behavior survives each initial structural release and legacy mechanisms are deprecated gradually,
- PostgreSQL data has tested recovery and the app can evolve toward stateless/redundant deployment without duplicate worker execution.

## 26. Auditability, Control Evidence, and IT Walkthrough Architecture

This section is a core design requirement, not an optional reporting enhancement.

The application should be designed so an IT auditor, control owner, system administrator, or process owner can perform a walkthrough and obtain reliable evidence without needing to reconstruct the control from code, manually correlate unrelated logs, or depend on screenshots with missing context.

The primary audit use cases are:

- **Test of Design (ToD):** demonstrate what the control was designed to do at a point in time and how the system enforced that design.
- **Test of Operating Effectiveness (ToE):** demonstrate that the control actually operated for selected transactions during a defined period.
- **ITAC testing:** demonstrate the configuration and operation of automated application controls and identify exceptions/bypasses.
- **ITGC change testing:** demonstrate who requested, reviewed, approved, implemented, tested, and verified a material configuration/control change.
- **IT walkthroughs:** provide a coherent, read-only, screenshot-ready path through the control, configuration, sample transaction, and supporting evidence.

### 26.1 Control Library

Create a bounded Control Library for controls UAR owns or materially supports.

A control definition should be versioned and may include:

- stable control ID, for example `UAR-AC-01`,
- control name,
- control objective,
- risk addressed,
- control owner,
- frequency,
- control type (`manual`, `IT-dependent manual`, `automated`, `hybrid`),
- preventive/detective classification where useful,
- relevant systems/capabilities,
- related workflow stages/permissions/configuration,
- expected evidence,
- population definition,
- exception criteria,
- effective-from/effective-to dates,
- current status.

Example:

`UAR-AC-01 - Access requests require authorized approval before provisioning.`

The control could map to:

- Request Type/version,
- Approval Workflow/version,
- Director/Faculty reviewer permissions,
- provisioning guard/service,
- related audit event keys,
- automated tests asserting that provisioning cannot occur before required approval.

### 26.2 Control-to-System Mapping

An auditor should be able to answer "where is this control implemented?" without reading the entire application.

Control mappings should identify the applicable:

- capability/module,
- request/workflow type,
- workflow stage,
- role/permission,
- integration/provisioner,
- configuration version,
- notification/template where relevant,
- audit event/evidence source,
- automated test/control assertion.

These mappings must use stable identifiers rather than brittle UI labels where possible.

### 26.3 Evidence Center

Create an Evidence Center that is primarily a read model over canonical source data.

It should support evidence by:

- control,
- access request,
- user/subject,
- support ticket,
- lifecycle action,
- configuration change,
- audit period,
- evidence package/sample set.

For a selected access request, an evidence timeline might show:

`Submitted -> Email Verified -> Director Approved -> Faculty Approved -> AD Provisioned -> VPN Provisioned/Skipped -> Notification Sent -> Completed`

Each material step should display, where applicable:

- actor,
- actor type/role,
- action/decision,
- timestamp,
- prior/resulting state,
- workflow/configuration version,
- correlation ID,
- external system outcome,
- exception/override status,
- supporting source record IDs.

The Evidence Center should not duplicate every source record into a second audit table simply for display. It should correlate the canonical audit and domain-history records.

### 26.4 Walkthrough Mode

Provide a read-only Walkthrough Mode optimized for screen sharing, screenshots, and audit demonstrations.

A control walkthrough should be able to present, in a predictable order:

1. control objective and risk,
2. current or period-effective control design,
3. relevant configuration/workflow version,
4. authorized reviewer/role design,
5. application enforcement point,
6. selected sample transaction,
7. approval/decision evidence,
8. provisioning/external-side-effect evidence,
9. exceptions/overrides,
10. related change history,
11. control assertion/test status where applicable.

Walkthrough Mode must remain read-only and should avoid displaying secrets, reset tokens, credentials, unnecessary directory structure, or unrelated PII.

### 26.5 Screenshot-Ready Evidence Views

Screenshots are often necessary during walkthroughs, but they should be presentation artifacts over structured evidence rather than the only evidence source.

Evidence pages should render cleanly and include context such as:

- environment/system name,
- evidence generated timestamp and timezone,
- audit/evidence scope,
- control ID/version,
- source record identifier,
- workflow/configuration version,
- effective/as-of date where applicable,
- selected filters for populations,
- page/section title.

Avoid dynamic layouts where critical evidence is hidden behind hover-only interactions.

Where useful, add a dedicated **Capture/Print View** that removes navigation/noise and formats the evidence consistently for screenshot or PDF capture.

### 26.6 Test of Design (ToD)

ToD should demonstrate what the system was designed to enforce during the relevant period.

A ToD package for an automated approval control might include:

- control version,
- Request Type version,
- Approval Workflow version,
- required stages and approval rules,
- role/permission mappings,
- effective AD group mapping metadata,
- module/capability dependencies,
- provisioning guard/condition,
- effective dates,
- configuration change that introduced the design,
- relevant control assertion/automated test references.

Do not render today's configuration as if it were the historical design. The evidence layer must resolve the version effective for the requested period/sample.

### 26.7 Test of Operating Effectiveness (ToE)

For a selected sample, ToE should be able to demonstrate:

- the sample came from the defined population,
- submission/request attributes,
- the workflow/control version that applied,
- required approvers,
- actual approver identities and authorization context,
- decision timestamps,
- provisioning occurred only after required approval,
- external system result,
- notification/result where relevant,
- any retries/rollbacks/exceptions,
- final disposition.

A sample should link back to its population run so completeness and selection can be explained.

### 26.8 Population Reporting and Sampling

Support reproducible audit populations rather than relying on an administrator manually filtering a table and taking a screenshot.

A population definition should contain:

- population key/name,
- relevant control,
- source domain/table/read model,
- date basis (submitted/approved/completed/etc.),
- filters,
- inclusion/exclusion rules,
- generated-at timestamp,
- record count,
- generation actor/system,
- query/schema version where necessary for reproducibility.

Examples:

- all access requests approved between July 1 and September 30,
- all rejected access requests in a period,
- all configuration changes affecting `access_requests` controls,
- all password-reset completions,
- all privileged role assignments,
- all manual overrides/break-glass actions.

Sampling support may allow:

- auditor-selected samples,
- random samples using a recorded seed/method,
- targeted/high-risk samples,
- imported sample IDs from an external audit workpaper.

The purpose is traceability, not to replace the auditor's sampling methodology.

### 26.9 Change Governance, Design of Change, and Test of Change

Material changes to UAR's configuration/control design should have a change record instead of only an audit row saying "settings updated."

Change governance should be risk-based. Low-risk content changes may remain simple, while changes that affect access approval, authorization, provisioning, security, auditability, or integrations may require stronger workflow.

A `ConfigurationChange` or equivalent record may include:

- change ID,
- title/description,
- business/technical justification,
- risk classification,
- affected modules/controls,
- requester,
- reviewer/approver,
- planned implementation date,
- before configuration/version,
- proposed/after configuration/version,
- implementation plan,
- test plan,
- expected result,
- actual test result,
- tester,
- implementation actor/time,
- post-implementation verification,
- rollback or forward-recovery plan,
- linked GitHub issue/PR/change ticket where applicable,
- attachments/evidence artifacts,
- status (`draft`, `review`, `approved`, `implemented`, `verified`, `superseded`, etc.).

For high-risk configuration, consider a lifecycle such as:

`Draft -> Review -> Approved -> Published/Implemented -> Verified -> Superseded`

The exact stages should remain configurable within safe bounds and should not turn the system into a generic change-management product.

### 26.10 Evidence Artifacts and Attachments

Some walkthrough/change evidence may exist outside UAR, such as a screenshot, test result, approved workpaper excerpt, or external-system confirmation.

If evidence attachments are supported, store metadata such as:

- artifact ID,
- file name/type,
- uploader,
- timestamp,
- purpose/evidence category,
- related control/change/sample,
- cryptographic hash,
- storage reference,
- retention classification.

Do not allow attachments to become an uncontrolled secret/credential dump. Apply size/type restrictions, malware scanning where available, authorization, retention, and redaction guidance.

### 26.11 Evidence Package and Manifest

An Evidence Package should be an auditable export/collection, not merely a ZIP of screenshots.

A package may contain:

- package ID,
- control/audit period,
- selected population run,
- selected samples,
- structured evidence summaries,
- rendered HTML/PDF views where implemented,
- referenced evidence artifacts,
- generation timestamp,
- generating user/system,
- source record identifiers,
- configuration/workflow versions,
- manifest/hash metadata.

The manifest should let a reviewer understand exactly what was included and detect accidental modification of generated artifacts where practical.

### 26.12 Segregation of Duties and Exception Reporting

The system should be able to identify control exceptions such as:

- requester approved their own request,
- one person performed incompatible approval/provisioning roles where prohibited,
- approval occurred without the expected permission/role,
- manual override/break-glass path was used,
- provisioning occurred before required approval,
- required approval stage was skipped,
- configuration changed without required approval,
- external side effect failed but workflow incorrectly reported success,
- control assertion failed.

Exception detection should distinguish:

- expected/approved exception,
- emergency/break-glass use,
- system error,
- potential control failure.

Do not label every technical retry as a control deficiency.

### 26.13 Control Assertions and Automated Test Mapping

For important automated controls, define machine-readable control assertions where useful.

Examples:

- `An Access Request cannot become approved unless all required workflow stages are satisfied.`
- `Only identities with access_requests.review.faculty can satisfy a Faculty stage.`
- `Provisioning cannot execute before required approval.`
- `A disabled VPN capability cannot execute VPN provisioning.`
- `A published workflow version cannot be mutated in place.`
- `Passwords/tokens/secrets cannot be written into audit detail payloads.`

Assertions may map to:

- unit/integration tests,
- database invariants,
- service-level guards,
- scheduled health/control checks.

The evidence layer should report the assertion definition and most relevant test/health result, but should not claim that a passing automated test alone proves operating effectiveness for every period.

### 26.14 Continuous Control Monitoring Direction

Where the source data is strong enough, UAR may surface control-health indicators such as:

- executions in period,
- successful control executions,
- exceptions,
- bypasses,
- failed assertions,
- last configuration change,
- unresolved control exceptions.

Example presentation:

`UAR-AC-04 - External Faculty Approval`
`Design version: 2.1`
`Executions in last 90 days: 114`
`Completed with required approval: 114`
`Bypass/exception: 0`

Treat these as monitoring indicators based on defined data, not automatic audit conclusions.

### 26.15 Auditor Access Model

The Auditor role should support least-privilege read access to:

- Control Library,
- Evidence Center,
- population runs,
- assigned sample sets,
- relevant configuration history,
- approved change records,
- audit exports.

It should not automatically grant:

- configuration mutation,
- request approval,
- account provisioning,
- password reset execution,
- credential reveal,
- VPN/lifecycle mutation,
- secret access.

Sensitive evidence should remain scoped by need-to-know.

### 26.16 Historical Reproducibility and As-Of Evidence

A key audit requirement is the ability to answer: **What was the control design when this transaction occurred?**

Historical evidence should therefore prefer references to immutable/versioned records such as:

- workflow version,
- Request Type version,
- role/permission mapping version or effective snapshot,
- capability/configuration revision,
- template version,
- directory snapshot metadata where relevant.

When exact historical external-system state cannot be reconstructed, the UI must say so explicitly rather than presenting current state as historical fact.

### 26.17 Example Access Request Evidence Package

For an access-request sample, an evidence package should be able to show:

1. **Population provenance** - which population run contained the sample and why.
2. **Request submission** - requester/subject, request type, timestamp, non-sensitive attributes.
3. **Control design** - workflow/control version effective at submission/approval.
4. **Email verification** - verification completed and timestamp, without exposing token.
5. **Director review** - approver, role/permission basis, decision, timestamp.
6. **Faculty review** - if required by the effective workflow, approver and decision evidence.
7. **Provisioning** - AD/VPN service results and correlation IDs, with secrets redacted.
8. **Completion** - final status and completion timestamp.
9. **Exceptions** - override, retry, rollback, failure, or none.
10. **Change context** - material control/configuration changes relevant to the period.
11. **Evidence metadata** - environment, generated-at timestamp/timezone, source IDs, workflow/config versions.

The output should be understandable to a reviewer who was not present when the transaction occurred.

### 26.18 Auditability Design Principle

Every new feature in this roadmap should answer the following before it is considered complete:

1. What meaningful actions/configuration changes must be logged?
2. Which routine events should remain operational telemetry rather than durable audit evidence?
3. What version/snapshot must be retained so historical behavior remains explainable?
4. How would an auditor generate a complete population for this feature?
5. What would a selected sample's evidence chain look like?
6. What exceptions/overrides need explicit visibility?
7. Which permissions can view/export the evidence?
8. Are sensitive values redacted from both logs and evidence exports?
9. What automated assertion/test demonstrates the intended design where applicable?
10. Can a walkthrough be completed without mutating production state?

Auditability should therefore influence the data model and service boundaries at design time rather than being added after the operational feature is finished.
