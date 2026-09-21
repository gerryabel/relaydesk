-- Phase 8 Task 2: Automation Rule Management
-- Adds priority to AutomationRule, nullable ruleId + ruleNameSnapshot to AutomationExecution
-- so rule deletion preserves execution history.

-- ─────────────────────────────────────────────────────────────────────────────
-- AutomationExecution: preserve history on rule delete
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop existing FK (current schema: ON DELETE CASCADE)
ALTER TABLE "AutomationExecution" DROP CONSTRAINT IF EXISTS "AutomationExecution_ruleId_fkey";

-- 2. Make ruleId nullable so SET NULL can apply on rule delete
ALTER TABLE "AutomationExecution" ALTER COLUMN "ruleId" DROP NOT NULL;

-- 3. Add ruleNameSnapshot with temporary DEFAULT for backfill
ALTER TABLE "AutomationExecution" ADD COLUMN "ruleNameSnapshot" TEXT NOT NULL DEFAULT '';

-- 4. Backfill snapshot from the live rule relation
UPDATE "AutomationExecution" SET "ruleNameSnapshot" = "AutomationRule"."name"
  FROM "AutomationRule" WHERE "AutomationExecution"."ruleId" = "AutomationRule"."id";

-- 5. Remove temporary DEFAULT — Prisma declares `ruleNameSnapshot String` with no @default
ALTER TABLE "AutomationExecution" ALTER COLUMN "ruleNameSnapshot" DROP DEFAULT;

-- 6. Add new FK with ON DELETE SET NULL
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- AutomationRule: deterministic ordering via priority
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "AutomationRule" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "AutomationRule_workspaceId_triggerType_priority_idx"
  ON "AutomationRule"("workspaceId", "triggerType", "priority");
