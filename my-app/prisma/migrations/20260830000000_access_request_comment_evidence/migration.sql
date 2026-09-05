CREATE TABLE "RequestCommentAttachment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commentId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'clean',
    "forceDownload" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RequestCommentAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RequestCommentAttachment_storageKey_key"
    ON "RequestCommentAttachment"("storageKey");
CREATE INDEX "RequestCommentAttachment_commentId_idx"
    ON "RequestCommentAttachment"("commentId");
CREATE INDEX "RequestCommentAttachment_scanStatus_idx"
    ON "RequestCommentAttachment"("scanStatus");

ALTER TABLE "RequestCommentAttachment"
    ADD CONSTRAINT "RequestCommentAttachment_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "RequestComment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
