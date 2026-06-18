CREATE TABLE IF NOT EXISTS "OffboardCampaignRecipientToken" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'initial',
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "OffboardCampaignRecipientToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OffboardCampaignRecipientToken_tokenHash_key"
ON "OffboardCampaignRecipientToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipientToken_recipientId_idx"
ON "OffboardCampaignRecipientToken"("recipientId");

CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipientToken_expiresAt_idx"
ON "OffboardCampaignRecipientToken"("expiresAt");

CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipientToken_usedAt_idx"
ON "OffboardCampaignRecipientToken"("usedAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'OffboardCampaignRecipientToken_recipientId_fkey'
    ) THEN
        ALTER TABLE "OffboardCampaignRecipientToken"
        ADD CONSTRAINT "OffboardCampaignRecipientToken_recipientId_fkey"
        FOREIGN KEY ("recipientId") REFERENCES "OffboardCampaignRecipient"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;
