CREATE TABLE "MassEmailCampaign" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "quickSend" BOOLEAN NOT NULL DEFAULT false,
    "dryRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "targetSnapshot" JSONB,
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "eligibleRecipients" INTEGER NOT NULL DEFAULT 0,
    "skippedRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MassEmailCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MassEmailRecipient" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "adUsername" TEXT,
    "adDn" TEXT,
    "accountEnabled" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "sources" JSONB,
    "emailClaimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "messageId" TEXT,
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "MassEmailRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MassEmailLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "eventType" TEXT NOT NULL,
    "actor" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "MassEmailLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MassEmailCampaign_status_idx" ON "MassEmailCampaign"("status");
CREATE INDEX "MassEmailCampaign_createdAt_idx" ON "MassEmailCampaign"("createdAt");
CREATE INDEX "MassEmailCampaign_createdBy_idx" ON "MassEmailCampaign"("createdBy");

CREATE UNIQUE INDEX "MassEmailRecipient_campaignId_email_key" ON "MassEmailRecipient"("campaignId", "email");
CREATE INDEX "MassEmailRecipient_campaignId_idx" ON "MassEmailRecipient"("campaignId");
CREATE INDEX "MassEmailRecipient_status_idx" ON "MassEmailRecipient"("status");
CREATE INDEX "MassEmailRecipient_email_idx" ON "MassEmailRecipient"("email");
CREATE INDEX "MassEmailRecipient_adUsername_idx" ON "MassEmailRecipient"("adUsername");

CREATE INDEX "MassEmailLog_campaignId_idx" ON "MassEmailLog"("campaignId");
CREATE INDEX "MassEmailLog_recipientId_idx" ON "MassEmailLog"("recipientId");
CREATE INDEX "MassEmailLog_eventType_idx" ON "MassEmailLog"("eventType");
CREATE INDEX "MassEmailLog_level_idx" ON "MassEmailLog"("level");
CREATE INDEX "MassEmailLog_createdAt_idx" ON "MassEmailLog"("createdAt");

ALTER TABLE "MassEmailRecipient" ADD CONSTRAINT "MassEmailRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MassEmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MassEmailLog" ADD CONSTRAINT "MassEmailLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MassEmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MassEmailLog" ADD CONSTRAINT "MassEmailLog_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "MassEmailRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;