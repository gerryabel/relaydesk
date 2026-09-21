-- CreateEnum
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('pending', 'evaluating', 'awaiting_actions', 'executing', 'completed', 'partial_failure', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "AutomationActionExecutionStatus" AS ENUM ('pending', 'completed', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "triggerType" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationExecution" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "sourceEventType" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "sourceAggregateId" TEXT NOT NULL,
    "ticketId" TEXT,
    "status" "AutomationExecutionStatus" NOT NULL,
    "leasedBy" TEXT,
    "leasedAt" TIMESTAMP(3),
    "evaluatedConditions" BOOLEAN NOT NULL DEFAULT false,
    "skipReason" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationActionExecution" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "actionIndex" INTEGER NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionConfig" JSONB NOT NULL,
    "status" "AutomationActionExecutionStatus" NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationActionExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentSlaBreachNotification" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "slaType" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentSlaBreachNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_workspaceId_name_key" ON "AutomationRule"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "AutomationRule_workspaceId_idx" ON "AutomationRule"("workspaceId");

-- CreateIndex
CREATE INDEX "AutomationRule_workspaceId_enabled_idx" ON "AutomationRule"("workspaceId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationExecution_sourceEventId_ruleId_key" ON "AutomationExecution"("sourceEventId", "ruleId");

-- CreateIndex
CREATE INDEX "AutomationExecution_workspaceId_createdAt_idx" ON "AutomationExecution"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_ruleId_createdAt_idx" ON "AutomationExecution"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_ticketId_idx" ON "AutomationExecution"("ticketId");

-- CreateIndex
CREATE INDEX "AutomationExecution_workspaceId_status_createdAt_idx" ON "AutomationExecution"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_leasedAt_idx" ON "AutomationExecution"("leasedAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_status_leasedBy_createdAt_idx" ON "AutomationExecution"("status", "leasedBy", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_status_leasedAt_createdAt_idx" ON "AutomationExecution"("status", "leasedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationActionExecution_executionId_actionIndex_key" ON "AutomationActionExecution"("executionId", "actionIndex");

-- CreateIndex
CREATE INDEX "AutomationActionExecution_executionId_status_idx" ON "AutomationActionExecution"("executionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SentSlaBreachNotification_ticketId_slaType_key" ON "SentSlaBreachNotification"("ticketId", "slaType");

-- CreateIndex
CREATE INDEX "SentSlaBreachNotification_ticketId_idx" ON "SentSlaBreachNotification"("ticketId");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationActionExecution" ADD CONSTRAINT "AutomationActionExecution_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AutomationExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
