CREATE TABLE "UserNotification" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "username" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'info',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "href" TEXT,
  "readAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserNotification_username_dedupeKey_key" ON "UserNotification"("username", "dedupeKey");
CREATE INDEX "UserNotification_username_dismissedAt_createdAt_idx" ON "UserNotification"("username", "dismissedAt", "createdAt");
CREATE INDEX "UserNotification_username_readAt_idx" ON "UserNotification"("username", "readAt");

CREATE TABLE "UserNotificationPreference" (
  "username" TEXT NOT NULL,
  "accessRequests" BOOLEAN NOT NULL DEFAULT true,
  "supportTickets" BOOLEAN NOT NULL DEFAULT true,
  "syncFailures" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("username")
);
