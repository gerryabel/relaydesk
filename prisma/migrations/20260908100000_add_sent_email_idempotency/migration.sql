-- CreateTable
CREATE TABLE "SentEmail" (
    "id" TEXT NOT NULL,
    "outboxEventId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "SentEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SentEmail_outboxEventId_key" ON "SentEmail"("outboxEventId");

-- CreateIndex
CREATE INDEX "SentEmail_outboxEventId_idx" ON "SentEmail"("outboxEventId");

-- CreateIndex
CREATE INDEX "SentEmail_claimedAt_idx" ON "SentEmail"("claimedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SentEmail_outboxEventId_sending_key" ON "SentEmail"("outboxEventId") WHERE "status" = 'SENDING';
