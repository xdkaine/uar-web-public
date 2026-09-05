# Platform Delivery Context

## Purpose

This context owns the contract that makes the Next.js application start, validate, migrate, and run consistently across local Docker, CI, and deployed environments.

## Primary responsibilities

- PostgreSQL schema, checked-in Prisma migrations, and separate portal-runtime,
  auth-runtime, and migration database roles.
- Environment-variable validation and examples.
- Dockerfile stages, Compose services (including the `auth-service` OIDC provider container, ADR-0012), health checks, ports, volumes, and startup behavior. Host publishing is parameterized via `APP_PORT`/`AUTH_PORT` (dev defaults 4002/4003); container-internal ports stay fixed at 3002/3003.
- Production ingress assumptions: compose publishes ports only; TLS/name-based routing is terminated by an external reverse proxy on the deployment VM (`docs/deploy/nginx-auth.example.conf`).
- Jenkins build and deployment wiring.
- LDAP TLS, database TLS, Redis/Upstash, SMTP, Turnstile, cron-secret, and proxy-trust configuration.

## Required invariants

- Keep `my-app/lib/env-validator.ts`, `.env.example`, `my-app/.env.example`, `Dockerfile`, `docker-compose.yml`, `Jenkinsfile`, and deployment documentation aligned for every required variable.
- Never commit or print real secrets, resolved secret-bearing configuration, credentials, tokens, or production data.
- Preserve LDAP certificate verification and the intended database TLS posture. Do not turn off verification to make a local or CI check pass.
- Schema changes require a checked-in migration whose SQL and data implications have been inspected. Do not use `prisma db push` or destructive reset commands as a substitute for migration design.
- Production migration execution, deploys, volume deletion, and connections to non-local infrastructure require explicit authorization.
- Redis-backed protections must fail according to the application's documented security posture; in-memory fallbacks must not be mistaken for distributed production behavior.
- Provider probes and reverse-proxy 502/503/504 handling classify OIDC availability but never authorize a sign-in method. Browser DNS or TLS failure at the public auth hostname cannot be redirected by the portal or proxy (ADR-0021).
- `AUTH_MODE`, `AUTH_OIDC_ALTERNATE_SIGNIN`, and `AUTH_OIDC_OUTAGE_FALLBACK` are legacy bootstrap inputs only while no `auth.signInPolicy` exists. Saved portal policy is authoritative (ADR-0023).
- Production auth-service startup requires persistent `AUTH_JWKS`; rotation retains old and new public keys for the complete token and cache lifetime and proves stable issuer/signing identity across restart.
- Portal and auth runtimes use separate database login roles. Neither runtime can read the other application's credential hashes or client secrets; only `MIGRATION_DATABASE_URL` may execute portal-first/auth-second migrations. Runtime grants are reapplied and negatively verified after every migration.
- Build-time placeholder values must never become runtime credentials or conceal a missing production configuration contract.

## Important paths

- `my-app/prisma/schema.prisma` and `my-app/prisma/migrations/`
- `my-app/lib/env-validator.ts`, `prisma.ts`, `ratelimit.ts`, `email-config.ts`, and `ldap/client.ts`
- `my-app/next.config.ts` and `my-app/prisma.config.ts`
- `.env.example`, `my-app/.env.example`, `Dockerfile`, `docker-compose.yml`, and `Jenkinsfile`

## Validation expectations

- Run `docker compose config --quiet` without publishing rendered configuration.
- Inspect environment-name parity and migration SQL directly.
- Build the production builder image for application, dependency, Prisma, or delivery changes; run lint and tests from that image when applicable.
- Report whether only static configuration, a local container, or actual external integration was validated.
- Run `lifecycle_operations_reviewer` for deployment, migration, or environment-contract changes.
