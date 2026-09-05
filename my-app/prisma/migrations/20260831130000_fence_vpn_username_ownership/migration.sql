-- Serialize every VPN username ownership change with lifecycle deletion.
-- Application code uses the same hashtextextended(username, 904771) key.
-- Keeping the fence in PostgreSQL protects imports, infrastructure sync,
-- request edits, batch creation, and future write paths from bypassing it.

CREATE OR REPLACE FUNCTION "lockVpnAccountUsernameOwnership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
BEGIN
  FOR candidate IN
    SELECT DISTINCT normalized
    FROM (
      VALUES
        (NULLIF(lower(btrim(CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."username" END)), '')),
        (NULLIF(lower(btrim(CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."username" END)), ''))
    ) AS usernames(normalized)
    WHERE normalized IS NOT NULL
    ORDER BY normalized
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(candidate, 904771));
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION "lockAccessRequestVpnUsernameOwnership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
BEGIN
  FOR candidate IN
    SELECT DISTINCT normalized
    FROM (
      VALUES
        (NULLIF(lower(btrim(CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."vpnUsername" END)), '')),
        (NULLIF(lower(btrim(CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."linkedVpnUsername" END)), '')),
        (NULLIF(lower(btrim(CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."vpnUsername" END)), '')),
        (NULLIF(lower(btrim(CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."linkedVpnUsername" END)), ''))
    ) AS usernames(normalized)
    WHERE normalized IS NOT NULL
    ORDER BY normalized
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(candidate, 904771));
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS "VPNAccount_username_ownership_fence" ON "VPNAccount";
DROP TRIGGER IF EXISTS "VPNAccount_username_ownership_update_fence" ON "VPNAccount";
CREATE TRIGGER "VPNAccount_username_ownership_fence"
BEFORE INSERT OR DELETE ON "VPNAccount"
FOR EACH ROW
EXECUTE FUNCTION "lockVpnAccountUsernameOwnership"();
CREATE TRIGGER "VPNAccount_username_ownership_update_fence"
BEFORE UPDATE OF "username", "accessRequestId" ON "VPNAccount"
FOR EACH ROW
EXECUTE FUNCTION "lockVpnAccountUsernameOwnership"();

DROP TRIGGER IF EXISTS "AccessRequest_vpn_username_ownership_fence" ON "AccessRequest";
DROP TRIGGER IF EXISTS "AccessRequest_vpn_username_ownership_update_fence" ON "AccessRequest";
CREATE TRIGGER "AccessRequest_vpn_username_ownership_fence"
BEFORE INSERT OR DELETE ON "AccessRequest"
FOR EACH ROW
EXECUTE FUNCTION "lockAccessRequestVpnUsernameOwnership"();
CREATE TRIGGER "AccessRequest_vpn_username_ownership_update_fence"
BEFORE UPDATE OF "vpnUsername", "linkedVpnUsername", "status" ON "AccessRequest"
FOR EACH ROW
EXECUTE FUNCTION "lockAccessRequestVpnUsernameOwnership"();
