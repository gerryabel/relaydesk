-- Add SentSlaNotification model for SLA-at-risk duplicate suppression
-- and SLA_AT_RISK value to the NotificationType enum.

CREATE TABLE "SentSlaNotification" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "slaType" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SentSlaNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SentSlaNotification_ticketId_slaType_key" ON "SentSlaNotification"("ticketId", "slaType");
CREATE INDEX "SentSlaNotification_ticketId_idx" ON "SentSlaNotification"("ticketId");

ALTER TYPE "NotificationType" ADD VALUE 'SLA_AT_RISK';
