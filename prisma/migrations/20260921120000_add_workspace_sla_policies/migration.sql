-- Phase 8 Task 4: Configurable workspace-scoped SLA policies.
--
-- Creates the WorkspaceSlaPolicy table, seeds the four canonical default
-- policies for every existing workspace, and enforces the (workspaceId,
-- priority) unique constraint with a cascading foreign key to Workspace.
--
-- Defaults are expressed as wall-clock minutes and must match the canonical
-- application-level definition in src/lib/tickets/sla.ts exactly:
--   low:    response 1440, resolution 7200
--   medium: response  480, resolution 4320
--   high:   response  240, resolution 1440
--   urgent: response   60, resolution  240

-- CreateTable
CREATE TABLE "WorkspaceSlaPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "priority" "TicketPriority" NOT NULL,
    "responseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSlaPolicy_workspaceId_priority_key" ON "WorkspaceSlaPolicy"("workspaceId", "priority");

-- CreateIndex
CREATE INDEX "WorkspaceSlaPolicy_workspaceId_idx" ON "WorkspaceSlaPolicy"("workspaceId");

-- AddForeignKey
ALTER TABLE "WorkspaceSlaPolicy" ADD CONSTRAINT "WorkspaceSlaPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the four canonical default SLA policy rows for every existing
-- workspace. Deterministic text IDs (sla_<workspaceId>_<priority>) guarantee
-- stable references without relying on UUID generation. Values match the
-- canonical minute-level defaults in DEFAULT_SLA_POLICIES_MINUTES.
INSERT INTO "WorkspaceSlaPolicy" ("id", "workspaceId", "priority", "responseMinutes", "resolutionMinutes", "createdAt", "updatedAt")
SELECT
    'sla_' || "id" || '_low',
    "id",
    'low',
    1440,
    7200,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Workspace";

INSERT INTO "WorkspaceSlaPolicy" ("id", "workspaceId", "priority", "responseMinutes", "resolutionMinutes", "createdAt", "updatedAt")
SELECT
    'sla_' || "id" || '_medium',
    "id",
    'medium',
    480,
    4320,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Workspace";

INSERT INTO "WorkspaceSlaPolicy" ("id", "workspaceId", "priority", "responseMinutes", "resolutionMinutes", "createdAt", "updatedAt")
SELECT
    'sla_' || "id" || '_high',
    "id",
    'high',
    240,
    1440,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Workspace";

INSERT INTO "WorkspaceSlaPolicy" ("id", "workspaceId", "priority", "responseMinutes", "resolutionMinutes", "createdAt", "updatedAt")
SELECT
    'sla_' || "id" || '_urgent',
    "id",
    'urgent',
    60,
    240,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Workspace";
