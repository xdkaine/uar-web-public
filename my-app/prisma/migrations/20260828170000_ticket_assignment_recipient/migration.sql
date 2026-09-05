-- Preserve the verified notification address resolved when an administrator
-- grants a direct user access to a ticket. Existing rows remain nullable and
-- continue through the legacy AccessRequest fallback.
ALTER TABLE "SupportTicketAssignment"
ADD COLUMN "targetEmail" TEXT;
