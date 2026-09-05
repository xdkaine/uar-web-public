# ADRs

System-wide ADRs live here. Context-specific ADRs live under `docs/contexts/<context>/adr/` (see `CONTEXT-MAP.md`). An ADR is written when a change moves a trust boundary, moves state ownership, changes migration strategy, or changes failure semantics.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-module-registry-and-vpn-decoupling.md) | Capability module registry and VPN decoupling | Accepted |
| [0002](0002-governance-workflow-versioning.md) | Versioned access-request review workflows and reviewer configuration | Accepted |
| [0003](0003-rbac-directory-mappings-compatibility.md) | RBAC roles, directory mappings, and legacy admin compatibility | Accepted |
| [0004](0004-message-template-ownership.md) | Message template ownership for operational copy | Accepted |
| [0005](0005-operational-config-precedence.md) | Operational configuration precedence and environment eviction | Accepted |
| [0006](0006-service-accounts-and-reviewer-identities.md) | Service-account credentials in System Configuration and distinct reviewer identities | Accepted |
| [0007](0007-support-ticket-ownership-and-directory-group-routing.md) | Support ticket ownership, assignment, and directory-group routing | Accepted |
| [0008](0008-configurable-workflow-automation-engine.md) | Configurable workflow automation over a curated primitive catalog | Superseded by [ADR-0013](0013-visual-workflow-graphs.md); curated-primitives governance invariant carries forward |
| [0009](0009-auth-service-separation-and-local-break-glass.md) | Authentication service separation and local break-glass accounts | Stage 2 superseded by [ADR-0012](0012-standalone-oidc-authentication-service.md); Stage 1 remains in force |
| [0010](0010-ticket-evidence-uploads-and-internal-asset-store.md) | Ticket evidence uploads and the internal asset store | Accepted |
| [0011](0011-granular-privileges-tab-and-action-gating.md) | Granular privileges - tab and action gating | Accepted |
| [0012](0012-standalone-oidc-authentication-service.md) | Standalone OIDC authentication service | Accepted (AD-only OIDC; service-local Auth Manager recovery) |
| [0013](0013-visual-workflow-graphs.md) | Visual workflow graphs over an expanded curated catalog | Accepted (supersedes ADR-0008) |
| [0014](0014-idp-session-control-plane.md) | IdP Session Control Plane | Accepted |
| [0015](0015-privilege-first-rbac.md) | Privilege-first RBAC mapped directly to AD groups | Accepted (supersedes the role-mapping stage of ADR-0004/ADR-0006) |
| [0016](0016-ldap-certificate-verification-posture.md) | LDAP certificate verification posture for closed-network deployments | Accepted |
| [0017](0017-device-risk-shadow-evidence.md) | Device-risk shadow evidence | Accepted (amends ADR-0014; enforcement remains prohibited) |
| [0018](0018-directory-only-lifecycle-overrides.md) | Directory-only lifecycle overrides | Accepted (deletion scope amended by ADR-0024) |
| [0019](0019-disabled-directory-account-deletion.md) | Governed deletion of disabled directory accounts | Accepted (amended by ADR-0024) |
| [0020](0020-revoked-vpn-record-deletion.md) | Permanent deletion of revoked VPN records | Accepted (amended by ADR-0024) |
| [0021](0021-guarded-oidc-outage-fallback.md) | Auth-service outage classification and browser return | Outage authorization superseded by ADR-0023 |
| [0022](0022-reviewed-direct-offboarding.md) | Reviewed direct offboarding without a verification campaign | Accepted |
| [0023](0023-operator-authorized-alternate-signin.md) | Portal-owned sign-in policy | Accepted |
| [0024](0024-reviewed-lifecycle-deletion-plans.md) | Reviewed lifecycle deletion plans | Accepted |
