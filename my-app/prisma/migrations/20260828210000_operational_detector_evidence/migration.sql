CREATE TABLE "OperationalSignal" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "detectorKey" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "summary" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "OperationalSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccessRequest_facultyNotificationState_facultyNotificationClaimedUntil_idx"
    ON "AccessRequest"("facultyNotificationState", "facultyNotificationClaimedUntil");
CREATE INDEX "AccessRequest_provisioningState_provisioningStartedAt_idx"
    ON "AccessRequest"("provisioningState", "provisioningStartedAt");

CREATE TABLE "OperationalSignalEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signalId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "transition" TEXT NOT NULL,
    "detectorKey" TEXT NOT NULL,
    "detectorVersion" INTEGER NOT NULL DEFAULT 1,
    "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "correlationId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "archiveEligibleAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "archiveId" TEXT,

    CONSTRAINT "OperationalSignalEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalEvidenceArchive" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rangeStart" TIMESTAMP(3) NOT NULL,
    "rangeEnd" TIMESTAMP(3) NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "ciphertextSha256" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "formatVersion" INTEGER NOT NULL DEFAULT 1,
    "readbackVerifiedAt" TIMESTAMP(3),
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalEvidenceArchive_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationalSignal_detectorKey_subjectKey_key"
    ON "OperationalSignal"("detectorKey", "subjectKey");
CREATE INDEX "OperationalSignal_status_lastSeenAt_idx"
    ON "OperationalSignal"("status", "lastSeenAt");
CREATE INDEX "OperationalSignal_subjectType_subjectId_idx"
    ON "OperationalSignal"("subjectType", "subjectId");

CREATE UNIQUE INDEX "OperationalSignalEvent_eventKey_key"
    ON "OperationalSignalEvent"("eventKey");
CREATE INDEX "OperationalSignalEvent_signalId_createdAt_idx"
    ON "OperationalSignalEvent"("signalId", "createdAt");
CREATE INDEX "OperationalSignalEvent_archiveEligibleAt_archivedAt_idx"
    ON "OperationalSignalEvent"("archiveEligibleAt", "archivedAt");
CREATE INDEX "OperationalSignalEvent_archiveId_idx"
    ON "OperationalSignalEvent"("archiveId");
CREATE INDEX "OperationalSignalEvent_correlationId_idx"
    ON "OperationalSignalEvent"("correlationId");

CREATE UNIQUE INDEX "OperationalEvidenceArchive_storageKey_key"
    ON "OperationalEvidenceArchive"("storageKey");
CREATE INDEX "OperationalEvidenceArchive_rangeEnd_idx"
    ON "OperationalEvidenceArchive"("rangeEnd");
CREATE INDEX "OperationalEvidenceArchive_retentionExpiresAt_idx"
    ON "OperationalEvidenceArchive"("retentionExpiresAt");

ALTER TABLE "OperationalSignalEvent"
    ADD CONSTRAINT "OperationalSignalEvent_signalId_fkey"
    FOREIGN KEY ("signalId") REFERENCES "OperationalSignal"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperationalSignalEvent"
    ADD CONSTRAINT "OperationalSignalEvent_archiveId_fkey"
    FOREIGN KEY ("archiveId") REFERENCES "OperationalEvidenceArchive"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
