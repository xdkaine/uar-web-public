-- Editable email subject lines for registered message templates (ADR-0004).
-- Null keeps the code-owned default subject; existing rows are unaffected.
-- Rollback: ALTER TABLE "MessageTemplate" DROP COLUMN "subject";

ALTER TABLE "MessageTemplate" ADD COLUMN "subject" TEXT;
