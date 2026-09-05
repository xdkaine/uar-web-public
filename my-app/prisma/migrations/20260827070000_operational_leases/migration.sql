CREATE TABLE "OperationalLease" (
  "key" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalLease_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "OperationalLease_expiresAt_idx" ON "OperationalLease"("expiresAt");
