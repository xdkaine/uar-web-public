# Auth-service signing keys

`AUTH_JWKS` is the auth service's persistent private signing JWK Set. The same
key set signs OIDC tokens and back-channel logout tokens; the service publishes
only the public members through its JWKS endpoint. Production startup fails if
`AUTH_JWKS` is absent or does not contain a usable private RSA signing key.

## Initial generation

Generate the key once from the auth-service directory:

```sh
cd services/auth-service
umask 077
npm ci
npm run jwks:generate > /restricted/secrets/auth-jwks.json
```

The generator writes one compact private JWK Set to standard output and no
other destination. Move the file immediately into the deployment secret store
as the exact `AUTH_JWKS` value, then securely remove the staging file according
to the host's secret-handling procedure. Do not paste the private JSON into a
shell command, terminal transcript, ticket, source file, or release log.

Before release, inspect the value only with secret-safe validation that returns
a status rather than the JSON itself. It must be a JSON object with one or more
RSA private keys, a stable `kid`, `use=sig`, and `alg=RS256`.

## Restart proof

Capture a digest of the public key set before and after recreating only the
auth-service container:

```sh
jwks_uri=$(curl --fail --silent https://auth.example.org/.well-known/openid-configuration \
  | jq -er '.jwks_uri')
curl --fail --silent "$jwks_uri" \
  | jq -cS '{keys: [.keys[] | {kty,kid,use,alg,n,e}] | sort_by(.kid)}' \
  | sha256sum
```

The digest and published `kid` must remain unchanged across the restart. Also
complete an authorization-code sign-in and verify that a relying party accepts
the resulting token and back-channel logout. A stable container health check
alone does not prove signing continuity.

## Rotation

Use an overlap rotation so relying parties can validate tokens issued before
the cutover:

1. Generate a new JWK Set with `npm run jwks:generate` and extract its one new
   private key inside the approved secret-handling environment.
2. Build a temporary `AUTH_JWKS` containing the new key first and the current
   key second. Keep distinct `kid` values.
3. Deploy the overlap set to every auth-service replica. Verify discovery,
   public JWKS publication, a newly issued token, the RFC 9207 `iss` value, and
   logout-token validation.
4. Wait at least the longest token, authorization-code, provider-session, and
   relying-party JWKS-cache lifetime used by any registered client.
5. Remove the old key, deploy the final one-key set, and repeat the restart
   proof.

The implementation selects the first usable private RSA key for the shared
logout signer; validate in a production-like environment that the OIDC provider
also signs new tokens with the first key before beginning a production overlap.
If that proof fails, stop the rotation and keep the current set.

Do not rotate by deleting the current key first. Do not use ephemeral startup
keys as a rollback. Restore the prior secret value if the overlap release fails,
then verify its original public digest before reopening sign-in.
