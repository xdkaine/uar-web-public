ALTER TABLE "AccessRequest"
  ADD COLUMN "stageNotificationState" TEXT,
  ADD COLUMN "stageNotificationStageKey" TEXT,
  ADD COLUMN "stageNotificationError" TEXT,
  ADD COLUMN "stageNotificationStateChangedAt" TIMESTAMP(3);

CREATE INDEX "AccessRequest_stageNotificationState_idx"
  ON "AccessRequest"("stageNotificationState");
