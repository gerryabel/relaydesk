-- CreateEnum
CREATE TYPE "TicketActivityType" AS ENUM ('TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_UNASSIGNED', 'STATUS_CHANGED', 'PRIORITY_CHANGED');

-- CreateTable
CREATE TABLE "TicketActivity" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "TicketActivityType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketActivity_ticketId_createdAt_idx" ON "TicketActivity"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketActivity_createdAt_idx" ON "TicketActivity"("createdAt");

-- AddForeignKey
ALTER TABLE "TicketActivity" ADD CONSTRAINT "TicketActivity_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketActivity" ADD CONSTRAINT "TicketActivity_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
