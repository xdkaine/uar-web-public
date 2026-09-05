-- Privilege-first RBAC: privileges map directly to AD groups (no roles).
-- Creates PrivilegeAssignment and migrates existing RoleDefinition group
-- mappings into it: every (permission, group DN) pair across all roles is
-- unioned, so nobody loses mapped access. RoleDefinition rows are kept
-- untouched for rollback. Legacy domain admins (ldap.adminGroups) and
-- break-glass accounts are unaffected: they always hold the full catalog.

CREATE TABLE "PrivilegeAssignment" (
    "permissionKey" TEXT NOT NULL,
    "adGroupDns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivilegeAssignment_pkey" PRIMARY KEY ("permissionKey")
);

CREATE INDEX "PrivilegeAssignment_updatedAt_idx" ON "PrivilegeAssignment"("updatedAt");

-- Roll forward: union role -> (permission, group) pairs. A permission that
-- appeared only in roles with zero mapped groups intentionally produces no
-- assignment row (absence of a row == nobody mapped, which is equivalent).
INSERT INTO "PrivilegeAssignment" ("permissionKey", "adGroupDns", "updatedAt")
SELECT
    perm AS "permissionKey",
    ARRAY_AGG(DISTINCT grp) AS "adGroupDns",
    NOW() AS "updatedAt"
FROM "RoleDefinition" rd
CROSS JOIN LATERAL UNNEST(rd.permissions) AS perm
CROSS JOIN LATERAL UNNEST(rd."adGroupDns") AS grp
GROUP BY perm;

-- Rollback: restore role mappings is not automatic. RoleDefinition rows were
-- never modified, so reverting the application to a role-based build restores
-- the previous behavior exactly; drop the table only after rollback:
-- DROP TABLE "PrivilegeAssignment";
