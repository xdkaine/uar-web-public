-- Repair only the migration-owned faculty handoff default. Operator-customized
-- templates and archived revision history are intentionally preserved.
WITH legacy_default AS (
  SELECT E'Hello!\n\nI am requesting for you to {{actionPhrase}} with the following details:\n\nName: {{name}}\nEmail: {{email}}\n{{vpnUsernameLine}}\nPassword: {{password}}{{accountDisableDate}}\n\nPlease let me know once the account has been created.\n\nThank you!'::text AS body
), corrected_default AS (
  SELECT E'Hello!\n\nPlease {{actionPhrase}} using the following details:\n\nName: {{name}}\nEmail: {{email}}\n{{vpnUsernameLine}}\nPassword: {{password}}{{accountDisableDate}}\n\n{{completionRequest}}\n\nThank you!'::text AS body
)
UPDATE "MessageTemplate" AS template
SET
  "body" = corrected_default.body,
  "variables" = '["actionPhrase","name","email","vpnUsernameLine","password","accountDisableDate","completionRequest"]'::jsonb,
  "updatedBy" = 'migration-copy-fix',
  "updatedAt" = CURRENT_TIMESTAMP
FROM legacy_default, corrected_default
WHERE template."key" = 'faculty.handoff_message'
  AND template."body" = legacy_default.body;

WITH legacy_default AS (
  SELECT E'Hello!\n\nI am requesting for you to {{actionPhrase}} with the following details:\n\nName: {{name}}\nEmail: {{email}}\n{{vpnUsernameLine}}\nPassword: {{password}}{{accountDisableDate}}\n\nPlease let me know once the account has been created.\n\nThank you!'::text AS body
), corrected_default AS (
  SELECT E'Hello!\n\nPlease {{actionPhrase}} using the following details:\n\nName: {{name}}\nEmail: {{email}}\n{{vpnUsernameLine}}\nPassword: {{password}}{{accountDisableDate}}\n\n{{completionRequest}}\n\nThank you!'::text AS body
)
UPDATE "MessageTemplateRevision" AS revision
SET
  "body" = corrected_default.body,
  "updatedBy" = 'migration-copy-fix',
  "updatedAt" = CURRENT_TIMESTAMP
FROM legacy_default, corrected_default
WHERE revision."templateKey" = 'faculty.handoff_message'
  AND revision."status" IN ('published', 'draft')
  AND revision."body" = legacy_default.body;
