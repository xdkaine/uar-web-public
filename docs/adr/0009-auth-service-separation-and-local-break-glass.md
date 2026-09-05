# ADR-0009: Authentication service separation and local break-glass accounts

Status: Stage 2 superseded by [ADR-0012](0012-standalone-oidc-authentication-service.md) — the separate container speaks OIDC instead of sharing the session store. Stage 1 (provider seam, local break-glass accounts) remains in force and carries into the auth service.

## Context

Authentication is a monolithic LDAPS bind inside the Next.js app: `POST /api/auth/login` rate-limits, checks Turnstile, binds user credentials against Active Directory, resolves reviewer roles live, and mints an opaque session cookie. There is no second provider and no local fallback. "Break glass" today means a login-lockout recovery compose profile that clears `loginDisabled` - it still depends entirely on AD being reachable.

Two problems follow. If the domain controller is unavailable, nobody can authenticate at all, including administrators who would need to diagnose or dismiss alerts about exactly that outage. And the login boundary cannot evolve (second factor for admins, future SSO) without redeploying the whole application.

The operator direction: separate authentication from the application into its own service/container, with local break-glass accounts usable when AD is down, on top of - not instead of - the existing AD path.

## Decision

**Staged extraction.**

Stage 1 - provider seam inside the existing app (prerequisite, behavior-preserving):

1. Introduce `lib/auth/provider.ts`: a provider interface (`authenticate(username, password, context)`) with two implementations - the current LDAPS bind moved behind it unchanged as the default, and a local-account provider backed by a new `LocalAccount` table storing only salted password hashes (scrypt/argon2id via Node crypto; never plaintext), an explicit `purpose` marker (`break_glass`), enabled/disabled state, and last-used audit fields.
2. Login resolution order stays fail-closed: AD bind first (unchanged diagnostics 52e/533/775/...), local provider consulted only when the directory itself is unreachable - transport-level failures such as timeouts and connection errors - and only for usernames that exist in `LocalAccount`. Policy denials (disabled, locked, expired accounts) never consult local credentials, so Active Directory remains the sole authority for account-state enforcement. Break-glass usernames are stored, matched, session-minted, and revoked in canonical lowercase end-to-end. Turnstile, rate limits, CSRF, session minting, cookie policy, lockout handling, and audit events apply identically to both providers. A successful break-glass login is auditable and visibly flagged in the session record (`Session.authProvider = 'local'`).
3. Local accounts are created/rotated by an authenticated system administrator through System Configuration; they are never seeded by migration with known credentials.

Stage 2 - separate auth service container:

1. A dedicated `auth` container owns the provider implementations, the session store contract, Turnstile verification, and login rate limiting. The main app validates sessions against the shared session store (Postgres `Session` table initially; Redis-backed cache allowed later) using the same hashing scheme - no shared filesystem, no cross-container trust beyond the database.
2. The app's middleware keeps verifying cookie presence only; API surfaces continue to validate sessions server-side, now through the store the auth service writes. Session row shape and hash algorithm become an explicit versioned contract documented alongside this ADR.
3. Rollout keeps both paths deployable: the auth service can run as the same image with a different entrypoint before the app's inline login route is removed.

## Consequences

- Administrators can sign in during directory outages with audited break-glass accounts; every other flow remains AD-first.
- The login boundary becomes independently scalable, monitorable, and evolvable; future providers plug into one interface.
- Two components must agree on the session contract; drift breaks all auth, so the contract gains tests on both sides of the boundary.
- Break-glass credentials become high-value secrets: rotation reminders, disabled-by-default posture, and alerting on their use are required follow-ups.

## Alternatives considered

- Keep authentication inline forever: rejected - total lockout during DC outages and no path to additional factors or SSO.
- Jump straight to the separate container: rejected - extracting the provider first lets behavior, tests, and audit move incrementally with a working fallback at every step.
- OAuth/OIDC against an external IdP instead of building the service: rejected for now - it moves the same dependency problem to an unmanaged external system; the interface keeps this option open.
