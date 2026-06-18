ALTER TABLE "AuditLog" ADD COLUMN "actorType" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "subjectUsername" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "subjectEmail" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "relatedRequestId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "relatedVpnAccountId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "relatedLifecycleActionId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "eventKind" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "outcome" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "correlationId" TEXT;

CREATE INDEX "AuditLog_actorType_idx" ON "AuditLog"("actorType");
CREATE INDEX "AuditLog_subjectUsername_createdAt_idx" ON "AuditLog"("subjectUsername", "createdAt");
CREATE INDEX "AuditLog_subjectEmail_createdAt_idx" ON "AuditLog"("subjectEmail", "createdAt");
CREATE INDEX "AuditLog_relatedRequestId_createdAt_idx" ON "AuditLog"("relatedRequestId", "createdAt");
CREATE INDEX "AuditLog_relatedVpnAccountId_createdAt_idx" ON "AuditLog"("relatedVpnAccountId", "createdAt");
CREATE INDEX "AuditLog_relatedLifecycleActionId_createdAt_idx" ON "AuditLog"("relatedLifecycleActionId", "createdAt");
CREATE INDEX "AuditLog_eventKind_idx" ON "AuditLog"("eventKind");
CREATE INDEX "AuditLog_outcome_idx" ON "AuditLog"("outcome");
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");