-- Preserve the auth-service-owned relations around the already-applied portal
-- drop migration without modifying that migration's checksum. PostgreSQL table
-- renames preserve every row, index, constraint, and encrypted secret exactly.
--
-- The guards also make this safe to introduce after a healthy database already
-- applied the historical drop: its auth-service table is renamed and restored
-- by the paired migration without copying or changing rows. A mixed state is
-- never guessed at.

DO $$
DECLARE
  branding_exists BOOLEAN := to_regclass('public."AuthBrandingProfile"') IS NOT NULL;
  clients_exists BOOLEAN := to_regclass('public."OidcClient"') IS NOT NULL;
  branding_transfer_exists BOOLEAN := to_regclass('public."__portal_transfer_AuthBrandingProfile"') IS NOT NULL;
  clients_transfer_exists BOOLEAN := to_regclass('public."__portal_transfer_OidcClient"') IS NOT NULL;
BEGIN
  IF branding_exists AND branding_transfer_exists THEN
    RAISE EXCEPTION 'Cannot preserve AuthBrandingProfile: source and reserved transfer relation both exist';
  END IF;

  IF clients_exists AND clients_transfer_exists THEN
    RAISE EXCEPTION 'Cannot preserve OidcClient: source and reserved transfer relation both exist';
  END IF;

  IF branding_exists THEN
    ALTER TABLE "AuthBrandingProfile" RENAME TO "__portal_transfer_AuthBrandingProfile";
  END IF;

  IF clients_exists THEN
    ALTER TABLE "OidcClient" RENAME TO "__portal_transfer_OidcClient";
  END IF;
END $$;
