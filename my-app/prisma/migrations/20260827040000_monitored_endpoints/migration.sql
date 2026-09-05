CREATE TABLE "MonitoredEndpoint" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL,
  "preset" TEXT NOT NULL DEFAULT 'generic_https',
  "protocol" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL,
  "path" TEXT,
  "timeoutMs" INTEGER NOT NULL DEFAULT 5000,
  "failureThreshold" INTEGER NOT NULL DEFAULT 2,
  "recoveryThreshold" INTEGER NOT NULL DEFAULT 2,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "currentState" TEXT NOT NULL DEFAULT 'unknown',
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "consecutiveSuccesses" INTEGER NOT NULL DEFAULT 0,
  "lastCheckedAt" TIMESTAMP(3),
  "lastTransitionAt" TIMESTAMP(3),
  "lastLatencyMs" INTEGER,
  "lastError" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "MonitoredEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MonitoredEndpoint_enabled_idx" ON "MonitoredEndpoint"("enabled");
CREATE INDEX "MonitoredEndpoint_currentState_idx" ON "MonitoredEndpoint"("currentState");
