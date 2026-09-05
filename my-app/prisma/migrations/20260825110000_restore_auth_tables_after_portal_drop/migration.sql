-- Restore the exact preserved relations after
-- 20260825100000_drop_portal_auth_branding_oidc_clients. This is deliberately
-- a rename, never a copy/recreate, so encrypted client secrets and all row
-- metadata retain their original bytes and identities.
--
-- On a database which has already completed the historical de-merge, this is
-- the paired restoration of the current auth-service-owned relation.

DO $$
DECLARE
  branding_exists BOOLEAN := to_regclass('public."AuthBrandingProfile"') IS NOT NULL;
  clients_exists BOOLEAN := to_regclass('public."OidcClient"') IS NOT NULL;
  branding_transfer_exists BOOLEAN := to_regclass('public."__portal_transfer_AuthBrandingProfile"') IS NOT NULL;
  clients_transfer_exists BOOLEAN := to_regclass('public."__portal_transfer_OidcClient"') IS NOT NULL;
BEGIN
  IF branding_exists AND branding_transfer_exists THEN
    RAISE EXCEPTION 'Cannot restore AuthBrandingProfile: canonical and reserved transfer relation both exist';
  END IF;

  IF clients_exists AND clients_transfer_exists THEN
    RAISE EXCEPTION 'Cannot restore OidcClient: canonical and reserved transfer relation both exist';
  END IF;

  IF branding_transfer_exists THEN
    ALTER TABLE "__portal_transfer_AuthBrandingProfile" RENAME TO "AuthBrandingProfile";
  END IF;

  IF clients_transfer_exists THEN
    ALTER TABLE "__portal_transfer_OidcClient" RENAME TO "OidcClient";
  END IF;
END $$;
