-- Drop redundant SentEmail indexes. The global unique constraint on "outboxEventId"
-- already guarantees single ownership, so the non-unique index and partial SENDING
-- unique index are unnecessary.
DROP INDEX IF EXISTS "SentEmail_outboxEventId_idx";
DROP INDEX IF EXISTS "SentEmail_outboxEventId_sending_key";
