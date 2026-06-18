-- CreateTable
CREATE TABLE "PasswordChangeChallenge" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordChangeChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordChangeChallenge_tokenHash_key" ON "PasswordChangeChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordChangeChallenge_tokenHash_idx" ON "PasswordChangeChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordChangeChallenge_username_idx" ON "PasswordChangeChallenge"("username");

-- CreateIndex
CREATE INDEX "PasswordChangeChallenge_expiresAt_idx" ON "PasswordChangeChallenge"("expiresAt");