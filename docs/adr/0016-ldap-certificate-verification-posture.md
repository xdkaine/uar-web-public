# ADR-0016: LDAP certificate verification posture for closed-network deployments

Date: 2026-08-26
Status: Accepted
Contexts: identity governance (primary), platform delivery

## Context

This deployment runs inside a restricted, closed network. LDAP traffic flows only
between internal servers; exposure to the public internet is not a realistic
threat for the foreseeable future. The domain controllers in this environment
present certificates that are expired or issued by an untrusted internal CA, and
there is no internal CA available to fix chain-of-trust cheaply.

`LDAP_ALLOW_INVALID_CERTS=true` therefore exists as an operator escape hatch.
On this branch its behavior is: `ldaps://` transport remains mandatory and
encrypted, but peer-certificate verification is skipped (`rejectUnauthorized:
false`) with a per-connection warning instead of a startup rejection
(see `my-app/lib/ldap/client.ts`). An alternative verification path already
exists independently: pinning a base64-encoded CA/public certificate via
`LDAP_CA_CERT_BASE64`, which enables full verification without any PKI project.

## Decision

Keep the current posture as the supported default for this deployment:

1. `LDAP_ALLOW_INVALID_CERTS=true` remains a deliberate operator override that
   disables peer-certificate verification while keeping the mandatory encrypted
   `ldaps://` transport. Per-connection warnings are retained so degraded mode
   stays visible in logs.
2. Verification-by-default stays the code path when the flag is unset or false;
   `LDAP_CA_CERT_BASE64` pinning is the recommended route to real verification
   and requires no infrastructure change (export the DC's existing certificate,
   base64-encode it, set the variable).
3. No additional acknowledgment variables or host allowlists are imposed: the
   operator has explicitly accepted the residual risk below for this network.

## Risks accepted

With verification disabled, another host on the same segment can impersonate the
domain controller and (a) relay bind credentials via active interception, or
(b) return forged responses — including group membership, which feeds
administrative access decisions (`LDAP_ADMIN_GROUPS`). The restriction of LDAP
traffic to a controlled server segment and the absence of internet exposure are
the compensating controls. Transport encryption still defeats passive
eavesdropping; only active interception/forgery is enabled by this posture.

## Future direction

If the deployment ever gains a trusted CA or reachable public trust, remove
`LDAP_ALLOW_INVALID_CERTS` (or set it false) and verify normally. A future
enhancement may add first-class certificate upload/configuration UX; until then,
`LDAP_CA_CERT_BASE64` pinning is the documented path to full verification.

## Rollback

Set `LDAP_ALLOW_INVALID_CERTS=false` or unset it. Verification resumes
immediately; connections to directories whose certificates cannot be verified
will fail loudly rather than silently degrade.
