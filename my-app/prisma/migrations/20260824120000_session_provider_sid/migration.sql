-- Link portal sessions to their OIDC provider session so logout can destroy
-- the IdP session (full logout). Nullable: native/local sessions have none.
ALTER TABLE "Session" ADD COLUMN "providerSid" TEXT;

-- Non-unique lookup for future backchannel sweeps by provider session.
CREATE INDEX "Session_providerSid_idx" ON "Session"("providerSid");
