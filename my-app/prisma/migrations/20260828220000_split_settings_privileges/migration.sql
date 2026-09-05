-- Split the configuration capabilities that were previously bundled behind
-- settings.manage. Existing settings administrators retain only the two
-- sections that contained the delegated appearance and break-glass behavior;
-- the original assignment remains intact for the General section.
--
-- Preserve any groups that an operator has already assigned to either new
-- capability before this migration is applied.

INSERT INTO "PrivilegeAssignment" ("permissionKey", "adGroupDns", "updatedBy", "updatedAt")
SELECT 'appearance.manage', "adGroupDns", "updatedBy", NOW()
FROM "PrivilegeAssignment"
WHERE "permissionKey" = 'settings.manage'
ON CONFLICT ("permissionKey") DO UPDATE
SET
  "adGroupDns" = ARRAY(
    SELECT DISTINCT group_dn
    FROM UNNEST("PrivilegeAssignment"."adGroupDns" || EXCLUDED."adGroupDns") AS group_dn
    ORDER BY group_dn
  ),
  "updatedAt" = NOW();

INSERT INTO "PrivilegeAssignment" ("permissionKey", "adGroupDns", "updatedBy", "updatedAt")
SELECT 'break_glass.manage', "adGroupDns", "updatedBy", NOW()
FROM "PrivilegeAssignment"
WHERE "permissionKey" = 'settings.manage'
ON CONFLICT ("permissionKey") DO UPDATE
SET
  "adGroupDns" = ARRAY(
    SELECT DISTINCT group_dn
    FROM UNNEST("PrivilegeAssignment"."adGroupDns" || EXCLUDED."adGroupDns") AS group_dn
    ORDER BY group_dn
  ),
  "updatedAt" = NOW();
