-- AlterEnum
ALTER TYPE "TicketActivityType" ADD VALUE 'TAG_ADDED';
ALTER TYPE "TicketActivityType" ADD VALUE 'TAG_REMOVED';

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tag_workspaceId_idx" ON "Tag"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_workspaceId_normalizedName_key" ON "Tag"("workspaceId", "normalizedName");

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TicketTag" (
    "ticketId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "TicketTag_pkey" PRIMARY KEY ("ticketId","tagId")
);

-- CreateIndex
CREATE INDEX "TicketTag_tagId_idx" ON "TicketTag"("tagId");

-- AddForeignKey
ALTER TABLE "TicketTag" ADD CONSTRAINT "TicketTag_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTag" ADD CONSTRAINT "TicketTag_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "Tag"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
