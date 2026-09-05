INSERT INTO "Event" ("id", "name", "description", "isActive", "createdAt", "updatedAt")
VALUES ('browser-fixture-event', 'Browser fixture event', 'Synthetic event for isolated browser proof.', TRUE, NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET "isActive" = TRUE, "updatedAt" = NOW();

INSERT INTO "AccessRequest" ("id", "name", "email", "isInternal", "needsDomainAccount", "isVerified", "status", "createdAt", "updatedAt") VALUES
  ('browser-director-request', 'Director Fixture', 'director-request@uar.test', TRUE, TRUE, TRUE, 'pending_student_directors', NOW(), NOW()),
  ('browser-faculty-request', 'Faculty Fixture', 'faculty-request@uar.test', TRUE, TRUE, TRUE, 'pending_faculty', NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET "status" = EXCLUDED."status", "updatedAt" = NOW();

INSERT INTO "PrivilegeAssignment" ("permissionKey", "adGroupDns", "updatedBy", "createdAt", "updatedAt") VALUES
  ('access_requests.review.director', ARRAY['CN=role-director,CN=Users,DC=uar,DC=test'], 'browser-fixture', NOW(), NOW()),
  ('access_requests.review.faculty', ARRAY['CN=role-faculty,CN=Users,DC=uar,DC=test'], 'browser-fixture', NOW(), NOW()),
  ('tickets.read', ARRAY['CN=role-group-assignee,CN=Users,DC=uar,DC=test', 'CN=role-ticket-admin,CN=Users,DC=uar,DC=test'], 'browser-fixture', NOW(), NOW()),
  ('tickets.respond', ARRAY['CN=role-group-assignee,CN=Users,DC=uar,DC=test', 'CN=role-ticket-admin,CN=Users,DC=uar,DC=test'], 'browser-fixture', NOW(), NOW()),
  ('tickets.assign', ARRAY['CN=role-ticket-admin,CN=Users,DC=uar,DC=test'], 'browser-fixture', NOW(), NOW()),
  ('tickets.configure', ARRAY['CN=role-ticket-admin,CN=Users,DC=uar,DC=test'], 'browser-fixture', NOW(), NOW()),
  ('messages.manage', ARRAY['CN=role-message-admin,CN=Users,DC=uar,DC=test'], 'browser-fixture', NOW(), NOW()),
  ('directory.configure', ARRAY['CN=role-directory-admin,CN=Users,DC=uar,DC=test'], 'browser-fixture', NOW(), NOW()),
  ('audit.export', ARRAY['CN=role-audit-exporter,CN=Users,DC=uar,DC=test'], 'browser-fixture', NOW(), NOW()),
  ('users.manage', ARRAY['CN=role-user-manager,CN=Users,DC=uar,DC=test'], 'browser-fixture', NOW(), NOW())
ON CONFLICT ("permissionKey") DO UPDATE SET "adGroupDns" = EXCLUDED."adGroupDns", "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = NOW();

INSERT INTO "AllowedTicketSubjectGroup" ("id", "dn", "name", "canBeRequestedFor", "canBeAssignee", "canJoinViaTicket", "autoApproveJoin", "createdBy", "updatedBy", "createdAt", "updatedAt")
VALUES ('browser-group-assignee', 'CN=role-group-assignee,CN=Users,DC=uar,DC=test', 'Browser group assignee', TRUE, TRUE, FALSE, FALSE, 'browser-fixture', 'browser-fixture', NOW(), NOW())
ON CONFLICT ("dn") DO UPDATE SET "canBeAssignee" = TRUE, "updatedAt" = NOW();
