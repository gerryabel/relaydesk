-- Add outboxEventId to Notification for SLA_AT_RISK handler idempotency.
-- The unique constraint allows multiple NULLs (notifications not tied to outbox
-- events remain unaffected) while guaranteeing at most one notification per
-- OutboxEvent under retry.

ALTER TABLE "Notification" ADD COLUMN "outboxEventId" TEXT;
CREATE UNIQUE INDEX "Notification_outboxEventId_key" ON "Notification"("outboxEventId");
