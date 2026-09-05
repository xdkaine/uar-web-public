# Repository Guidelines

## Project Structure & Module Organization

Docker is the primary interface. Run commands from the repository root; the Next.js 16 source is under `my-app/`.

- `my-app/app/`: App Router pages, layouts, and API handlers. API endpoints use `route.ts`.
- `my-app/components/`: shared React components and UI primitives.
- `my-app/lib/`: authentication, LDAP, email, validation, and persistence services.
- `my-app/prisma/`: PostgreSQL schema and timestamped SQL migrations.

Tests are colocated with implementation files as `*.test.ts`.

## Domain Context

Before changing behavior, read `CONTEXT-MAP.md`, the affected domain `CONTEXT.md` files, and applicable ADRs. The stable contexts are identity governance, lifecycle operations, and platform delivery. Cross-context changes require explicit integration validation.

Repository workflow metadata lives under `docs/agents/`:

- `issue-tracker.md`: GitHub issue ownership and external-action rules.
- `triage-labels.md`: the canonical issue-state labels.
- `domain.md`: how agents consume contexts and ADRs.

## Subagent Orchestration

The primary agent owns requirements, integration, final validation, and all user-facing conclusions. Delegate only independent work with explicit paths, permissions, validation criteria, and expected output. Use one writer per file or tightly coupled subtree, and never allow subagents to spawn additional agents.

Use the configured domain reviewers when their trigger paths or behaviors are affected:

- `identity_governance_reviewer`: authentication, authorization, LDAP/VPN provisioning, request approval, sessions, activation/reset, credentials, tokens, CSRF, Turnstile, rate limits, and security auditability.
- `lifecycle_operations_reviewer`: lifecycle queues, batch operations, offboarding, mass email, infrastructure sync, cron, Prisma migrations, Docker, Jenkins, and environment contracts.

Keep implementation on the primary thread or assign it to the generic `worker`; the domain specialists remain read-only. The primary agent must independently verify material subagent claims before declaring completion.

## Build, Test, and Development Commands

Use Docker Compose for the local, production-like environment:

- `docker compose config --quiet`: validate Compose syntax and required interpolation.
- `docker compose up --build -d`: build the app and start PostgreSQL, Redis, and Next.js.
- `docker compose ps`: inspect container state and health.
- `docker compose logs -f app`: follow application startup and runtime logs.
- `docker compose down`: stop the stack while preserving database and Redis volumes.

Host ports are parameterized: the portal publishes on `${APP_PORT:-4002}` (container-internal 3002) and the auth service on `${AUTH_PORT:-4003}` (container-internal 3003). To validate source with the same Node 22 build environment, run:

```bash
docker build --target builder -t uar-web:builder .
docker run --rm uar-web:builder npm run lint
docker run --rm uar-web:builder npm run test:run
```

The standalone auth service (`services/auth-service/`, ADR-0012) runs under compose `--profile auth`: start it with `docker compose --profile auth up --build -d`; without the profile only the portal stack starts. Run its checks locally from `services/auth-service/` with `npm ci`, then `npm run lint`, `npm test`, and `npx tsc --noEmit`, or containerized with `docker build -f services/auth-service/Dockerfile .` from the repo root (the image build runs `npm ci`, lint/test are available via the same commands inside a builder-stage container). `services/auth-service/dist/` is build output and is not tracked.

Rebuild after dependency, Prisma schema, or application changes.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, semicolons, and the `@/` import alias. Name React components and files in `PascalCase`, hooks as `useCamelCase`, utilities in `camelCase`, and route segments in lowercase kebab-case. Keep server logic in `lib/` or API handlers.

## Testing Guidelines

Vitest runs in a Node environment and discovers `**/*.test.ts`. Add focused tests beside changed business logic, especially authentication, cookie policy, validation, LDAP, and email behavior. No numeric coverage threshold is configured. Run the containerized lint and test commands before submitting.

Validation should match the change:

- Documentation or agent configuration: read back changed files, verify references and Git visibility, and run `docker compose config --quiet` when Compose guidance changes.
- UI: run lint and focused tests, then inspect affected responsive and interaction states.
- API or business logic: run focused tests plus the full Vitest suite; include negative authorization and failure-path coverage where relevant.
- Prisma, environment, or deployment: inspect generated SQL or configuration output, run the production builder, and use the applicable read-only domain reviewer.

Report the exact commands and results. Do not equate unrun checks with passing validation.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style subjects such as `feat:`, `fix:`, and scoped forms like `feat(audit):`. Keep commits focused and imperative. Pull requests should explain the change, operational or schema impact, and validation performed; link related issues and include screenshots for UI changes. Call out new environment variables or migrations explicitly.

## Security & Configuration

Compose reads configuration from the root `.env`; never commit real credentials or production data. Start from `.env.example`, use `ldaps://`, and preserve TLS verification. Do not publish rendered Compose configuration because it may contain resolved secrets. Review `my-app/lib/env-validator.ts` and Compose variable names together when changing configuration.

Treat PostgreSQL, LDAP/Active Directory, VPN infrastructure, Redis, SMTP, cron routes, and administrative batch actions as sensitive external systems. Without explicit user authorization for the exact target and action:

- Do not connect to or mutate non-local infrastructure.
- Do not run `prisma db push`, `prisma migrate reset`, seed/bootstrap commands, destructive SQL, `docker compose down -v`, or delete persistent volumes.
- Do not trigger lifecycle processing, offboarding, mass-email delivery, infrastructure sync, account provisioning, password changes, or other administrative mutations.
- Do not commit, push, deploy, or create/update GitHub issues or pull requests.

Never weaken LDAP certificate verification, authentication or authorization checks, CSRF, Turnstile, rate limiting, token hashing, cookie protections, audit logging, or secret redaction merely to make a test or deployment pass. Never print `.env`, rendered secret-bearing Compose configuration, credentials, reset or activation tokens, session tokens, or unnecessary PII.

For schema changes, update `schema.prisma`, create a checked-in migration, inspect its SQL and data implications, and document rollback or forward-recovery behavior. Production migration execution requires explicit authorization.
