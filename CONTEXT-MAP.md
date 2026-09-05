# UAR Domain Context Map

The UAR Portal is one Next.js application with several high-risk bounded contexts. Read only the contexts affected by the task, plus every context crossed by an execution path.

| Context | Responsibilities | Primary paths | Required reviewer |
| --- | --- | --- | --- |
| [Identity governance](docs/contexts/identity-governance/CONTEXT.md) | Public access requests, verification, authentication, authorization, LDAP/VPN provisioning, sessions, activation/reset, credentials, and identity auditability | `my-app/app/api/request`, `my-app/app/api/verify`, `my-app/app/api/auth`, `my-app/app/api/account`, `my-app/app/api/admin/requests`, `my-app/lib/ldap`, `my-app/lib/session.ts`, `my-app/middleware.ts` | `identity_governance_reviewer` |
| [Lifecycle operations](docs/contexts/lifecycle-operations/CONTEXT.md) | Batch work, lifecycle queues, offboarding, mass email, infrastructure reconciliation, cron processing, retries, and rollback | `my-app/app/api/admin/account-lifecycle`, `my-app/app/api/admin/batch-accounts`, `my-app/app/api/admin/offboard-campaigns`, `my-app/app/api/admin/mass-email`, `my-app/app/api/admin/settings/infrastructure-sync`, `my-app/app/api/cron`, `my-app/lib/lifecycle-processor.ts`, `my-app/lib/offboard-campaign.ts` | `lifecycle_operations_reviewer` |
| [Platform delivery](docs/contexts/platform-delivery/CONTEXT.md) | Prisma migrations, environment validation, Docker/Compose, Jenkins, TLS, Redis, SMTP, startup, and deployment | `my-app/prisma`, `my-app/lib/env-validator.ts`, `my-app/next.config.ts`, `Dockerfile`, `docker-compose.yml`, `Jenkinsfile`, `.env.example` | `lifecycle_operations_reviewer` |

## Cross-context rules

- Read all affected contexts before planning or editing.
- Use `architect` before implementation when a decision changes trust boundaries, state ownership, migration strategy, or failure semantics across contexts.
- Use both domain reviewers only when the same change crosses identity behavior and queued, bulk, or delivery behavior.
- System-wide ADRs belong in `docs/adr/`; context-specific ADRs belong under `docs/contexts/<context>/adr/`.
- If code and documentation disagree, treat code plus executable validation as current evidence and update the stale documentation in the same change when safe.
