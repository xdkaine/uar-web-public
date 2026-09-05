# Auth-service outage response

The Redis outage circuit from the original ADR-0021 no longer authorizes direct
sign-in. Provider probing remains useful only for failure classification,
operator status, and correlated audit evidence. `auth.signInPolicy` is the
portal's authority for every offered and accepted method.

## Readiness

1. Confirm the portal has a saved, audited sign-in policy with at least one
   enabled and usable method.
2. Confirm direct AD and portal local methods are disabled unless operators
   intentionally want them available during healthy service operation as well
   as an outage.
3. Confirm the public auth proxy applies 502/503/504 interception only to
   `/auth` and `/interaction...` browser routes. Protocol and Auth Manager
   endpoints must retain their original failure responses.
4. Confirm `proxy_redirect off` preserves provider `Location` values and that
   discovery, ID-token `iss`, and the RFC 9207 authorization-response `iss`
   equal the configured public `AUTH_ISSUER` exactly.
5. Document the public DNS/TLS failure path. If the browser cannot resolve or
   establish TLS to the auth hostname, no HTTP proxy can send it back to the
   portal.

## Exercise the browser return

Use an isolated production-like target. Do not stop a production provider to
create evidence.

1. Complete a healthy OIDC sign-in and record the enabled methods returned by
   the portal mode endpoint.
2. Make only the auth upstream unavailable behind a canary nginx instance.
3. Start a browser authorization request. Nginx should issue a 303 to
   `/login?error=oidc_unavailable` for an upstream 502, 503, or 504.
4. Verify the portal shows the operational error and only the direct methods
   already enabled by policy. Post each hidden method directly and confirm the
   server rejects it.
5. Call discovery, JWKS, token, logout, internal API, and Auth Manager routes as
   applicable. Confirm none is converted into the portal browser redirect.
6. Restore the upstream and complete OIDC sign-in again. Probe recovery may
   change status text but must not change the method list.

## Incident response

Keep the saved portal policy unchanged unless an authorized operator makes an
audited policy change. Do not use Redis keys, query parameters, cookies, or the
legacy `AUTH_OIDC_OUTAGE_FALLBACK` setting to reveal a disabled method.

If a portal backup is already enabled, users can return to the portal directly
and select it. If none is enabled, restore the auth service or make an explicit
policy change through the Sign-in settings surface. DNS and TLS incidents also
require restoring the public hostname or communicating the portal URL through
an established operational channel.

Preserve provider, proxy, Redis, and portal audit evidence. Do not delete
volumes or reset the database. Any cleanup of legacy `ad_outage_fallback` or
OIDC `local_break_glass` sessions occurs during a controlled sign-in block with
an approved inventory and revocation plan.
