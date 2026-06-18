CREATE TABLE "OffboardCampaignExtension" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "note" TEXT,
    "previousDeadlineAt" TIMESTAMP(3),
    "newDeadlineAt" TIMESTAMP(3) NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_notification',
    "reactivationRequired" BOOLEAN NOT NULL DEFAULT false,
    "reactivationAdActionId" TEXT,
    "reactivationVpnActionId" TEXT,
    "notificationSentAt" TIMESTAMP(3),
    "notificationMessageId" TEXT,
    "notificationError" TEXT,

    CONSTRAINT "OffboardCampaignExtension_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OffboardCampaignExtensionReminder" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "extensionId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "messageId" TEXT,
    "lastError" TEXT,

    CONSTRAINT "OffboardCampaignExtensionReminder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OffboardCampaignExtension_campaignId_idx" ON "OffboardCampaignExtension"("campaignId");
CREATE INDEX "OffboardCampaignExtension_recipientId_idx" ON "OffboardCampaignExtension"("recipientId");
CREATE INDEX "OffboardCampaignExtension_status_idx" ON "OffboardCampaignExtension"("status");
CREATE INDEX "OffboardCampaignExtension_newDeadlineAt_idx" ON "OffboardCampaignExtension"("newDeadlineAt");
CREATE INDEX "OffboardCampaignExtensionReminder_extensionId_idx" ON "OffboardCampaignExtensionReminder"("extensionId");
CREATE INDEX "OffboardCampaignExtensionReminder_scheduledFor_idx" ON "OffboardCampaignExtensionReminder"("scheduledFor");
CREATE INDEX "OffboardCampaignExtensionReminder_sentAt_idx" ON "OffboardCampaignExtensionReminder"("sentAt");

ALTER TABLE "OffboardCampaignExtension"
ADD CONSTRAINT "OffboardCampaignExtension_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "OffboardCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OffboardCampaignExtension"
ADD CONSTRAINT "OffboardCampaignExtension_recipientId_fkey"
FOREIGN KEY ("recipientId") REFERENCES "OffboardCampaignRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OffboardCampaignExtensionReminder"
ADD CONSTRAINT "OffboardCampaignExtensionReminder_extensionId_fkey"
FOREIGN KEY ("extensionId") REFERENCES "OffboardCampaignExtension"("id") ON DELETE CASCADE ON UPDATE CASCADE;
