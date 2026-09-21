-- Phase 8 Task 3: Automation Action Execution
--
-- Adds deduplication key columns to InternalNote and Notification to support
-- idempotent automation-created side effects under BullMQ redelivery.

-- InternalNote.automationDedupeKey: unique, nullable. Only set on notes
-- created by automation actions. Guarantees at-most-one note per automation
-- action (executionId:actionIndex).
ALTER TABLE "InternalNote" ADD COLUMN "automationDedupeKey" TEXT;
CREATE UNIQUE INDEX "InternalNote_automationDedupeKey_key" ON "InternalNote"("automationDedupeKey");

-- Notification.automationDedupeKey: unique, nullable. Only set on
-- notifications created by automation actions. Guarantees at-most-one
-- notification per automation action (executionId:actionIndex).
ALTER TABLE "Notification" ADD COLUMN "automationDedupeKey" TEXT;
CREATE UNIQUE INDEX "Notification_automationDedupeKey_key" ON "Notification"("automationDedupeKey");
