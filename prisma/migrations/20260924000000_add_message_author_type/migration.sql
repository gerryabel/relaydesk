-- Phase 9 Task 3: durable message authorship.
--
-- Every Message row now carries an explicit `authorType` plus the foreign key
-- that proves it:
--   agent    -> createdById NOT NULL, customerId NULL
--   customer -> createdById NULL, customerId NOT NULL
--   system   -> createdById NULL, customerId NULL
--
-- Prisma 7.9 cannot express `@@check`, so the invariant is enforced here with
-- named PostgreSQL CHECK constraints that the ORM layer and raw SQL both honour.

-- CreateEnum
CREATE TYPE "MessageAuthorType" AS ENUM ('agent', 'customer', 'system');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "authorType" "MessageAuthorType";
ALTER TABLE "Message" ADD COLUMN "customerId" TEXT;

-- Backfill legacy rows before the NOT NULL constraint is applied.
-- A message with an agent author maps to 'agent'; anything else (system
-- automation notes, historical seed rows) maps to 'system'.
UPDATE "Message"
SET "authorType" = CASE WHEN "createdById" IS NOT NULL THEN 'agent' ELSE 'system' END::"MessageAuthorType"
WHERE "authorType" IS NULL;

-- 'system' is the default for future writes that omit authorship explicitly.
-- It is the only value valid with no author foreign key, so an incomplete
-- legacy write fails the CHECK below instead of inventing a fake author.
ALTER TABLE "Message" ALTER COLUMN "authorType" SET NOT NULL;
ALTER TABLE "Message" ALTER COLUMN "authorType" SET DEFAULT 'system';

-- CreateIndex
CREATE INDEX "Message_customerId_idx" ON "Message"("customerId");

-- AddForeignKey
-- Cascade (not SetNull) so unlinking a customer can never leave a row with
-- authorType = 'customer' and customerId = NULL.
ALTER TABLE "Message" ADD CONSTRAINT "Message_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (replaced)
-- The inherited relation used ON DELETE SET NULL, which is now incompatible with
-- message_author_agent: deleting a user would null createdById and the CHECK
-- would reject the delete with an error that names the constraint instead of
-- the real cause. ON DELETE NO ACTION defers the check to the end of the
-- statement, so a cascading workspace delete (Workspace -> Membership -> User)
-- still succeeds while deleting an author who has written a message is refused.
ALTER TABLE "Message" DROP CONSTRAINT "Message_createdById_fkey";
ALTER TABLE "Message" ADD CONSTRAINT "Message_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Authorship invariant. Named so failures are diagnosable in production logs
-- and so the constraint can be referenced explicitly in tests.
ALTER TABLE "Message"
  ADD CONSTRAINT "message_author_agent"
  CHECK ("authorType" <> 'agent' OR ("createdById" IS NOT NULL AND "customerId" IS NULL));

ALTER TABLE "Message"
  ADD CONSTRAINT "message_author_customer"
  CHECK ("authorType" <> 'customer' OR ("createdById" IS NULL AND "customerId" IS NOT NULL));

ALTER TABLE "Message"
  ADD CONSTRAINT "message_author_system"
  CHECK ("authorType" <> 'system' OR ("createdById" IS NULL AND "customerId" IS NULL));

-- Self-check: the migration either left the invariant fully in place or did not
-- claim to. A migration that silently skipped one constraint would otherwise
-- look successful while leaving agent/customer authorship unenforced, and the
-- only symptom would be an unattributable message much later.
DO $$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(expected.name, ', ')
  INTO missing
  FROM (VALUES ('message_author_agent'), ('message_author_customer'), ('message_author_system')) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = expected.name
      AND c.contype = 'c'
      AND t.relname = 'Message'
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 9 Task 3 migration incomplete: missing CHECK constraints: %', missing;
  END IF;
END $$;
