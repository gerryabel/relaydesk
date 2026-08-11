-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "firstResponseAt" TIMESTAMP(3),
ADD COLUMN     "resolutionSlaDeadline" TIMESTAMP(3),
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "responseSlaDeadline" TIMESTAMP(3);
