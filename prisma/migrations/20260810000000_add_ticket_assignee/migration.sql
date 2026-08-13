-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "assignedToId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_assignedToId_key" ON "Ticket"("assignedToId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedToId_fkey" 
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") 
  ON DELETE SET NULL 
  ON UPDATE CASCADE;
