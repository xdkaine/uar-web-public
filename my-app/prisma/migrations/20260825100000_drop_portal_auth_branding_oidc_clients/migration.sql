-- De-merge auth-service surfaces from the portal. Sign-in branding profiles
-- and the OIDC client registry belong to the standalone authentication
-- service (which runs its own schema); the portal only acts as a relying
-- party configured through environment variables.
--
-- Where these tables live now:
--   - "AuthBrandingProfile": owned and migrated by the auth service
--     (20260825000000_add_auth_branding_profile).
--   - "OidcClient": owned and migrated by the auth service
--     (20260826000000_auth_service_owns_oidc_client_registry).
--
-- WARNING: this migration is DESTRUCTIVE for row data. Any branding profiles
-- or registered OIDC clients still present when it runs are deleted and are
-- UNRECOVERABLE (no backup is taken here). After de-merge, re-create clients
-- through the Auth Manager console and re-enter branding via its editor.
--
-- Rollback: recreate tables per migrations 20260824130000 and 20260824140000,
-- but any dropped rows are gone; only structure can be restored this way.

DROP TABLE IF EXISTS "AuthBrandingProfile";
DROP TABLE IF EXISTS "OidcClient";
