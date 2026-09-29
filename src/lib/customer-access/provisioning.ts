import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma';
import { CustomerWorkspaceMismatchError } from './errors';

/**
 * Atomic first-time customer provisioning (Phase 9 Task 1).
 *
 * Why this is not `customer.create` + catch-P2002:
 *
 * A unique-constraint violation aborts the surrounding statement, and inside a
 * PostgreSQL transaction the transaction is left in a failed state — every
 * subsequent command returns `current transaction is aborted`. Recovering by
 * re-SELECTing in the same transaction is therefore not sound, and the magic
 * link + outbox event written after it would fail too.
 *
 * Instead this uses the database-native no-op insert:
 *
 *   INSERT ... ON CONFLICT ("workspaceId","email") DO NOTHING RETURNING ...
 *
 * `ON CONFLICT DO NOTHING` is not an error, so the transaction stays healthy
 * and the follow-up SELECT is safe. The unique index
 * `Customer_workspaceId_email_key` remains the single arbiter of the race, so
 * there is no application-level read-then-write window.
 *
 * `DO NOTHING` (never `DO UPDATE`) is deliberate: provisioning must not
 * overwrite the real `name` of a customer that an agent has since corrected.
 *
 * A Prisma `upsert` was rejected here: with an empty `update` object its
 * generated SQL and its concurrency guarantees are version-dependent, and a
 * read-then-write upsert would still lose to a concurrent insert.
 *
 * Note on ids: `Customer.id` is `TEXT @default(cuid())`, which Prisma resolves
 * client-side, so raw SQL must supply the value. `randomUUID()` is used from
 * node:crypto to avoid adding a dependency; both formats are opaque unique
 * strings, and only rows created through this portal path carry a UUID.
 */

export interface CustomerIdentity {
  id: string;
  workspaceId: string;
  email: string;
}

type ProvisioningClient = Pick<Prisma.TransactionClient, '$queryRaw' | 'customer'>;

/**
 * Serializes magic-link issuance for one customer, by taking a row lock on the
 * `Customer` row itself.
 *
 * Issuance invalidates the customer's other outstanding links before inserting
 * the new one. That sweep is a read-then-write over several rows, so on its own
 * it is racy under concurrent requests: each transaction's `updateMany` only
 * observes rows committed before that statement runs, so a link inserted by a
 * transaction that commits *after* another request's sweep is never invalidated.
 * With 8 concurrent requests this reliably left 6-7 links outstanding instead
 * of 1.
 *
 * Locking the customer row closes that window. The row always exists by this
 * point (it was just resolved or provisioned, and on the provisioning path the
 * winner's insert has necessarily committed), so it needs no new coordination
 * table. Every issuance transaction takes this lock before the sweep, so the
 * sweep and the insert are strictly serialized per customer.
 *
 * Notes on why the customer row rather than `pg_advisory_xact_lock`:
 *
 *  - It is scoped to a row that already exists and is already the natural unit
 *    of work, so it introduces no second locking vocabulary.
 *  - Lock order is uniform (customer row, then its links), so no deadlock cycle
 *    can form between issuance transactions.
 *  - It is released automatically at commit or rollback, so it cannot leak
 *    across pooled connections.
 *
 * Why this is safe with the provisioning insert above: a transaction never
 * blocks on its own uncommitted row, so the first-time request that just
 * inserted the customer locks it immediately. Requests that lost the
 * provisioning race see the winner's committed row and block on it until that
 * transaction finishes.
 *
 * The `workspaceId` predicate is defense in depth: `id` is already unique, but
 * re-asserting the workspace here means a caller can never hold an issuance lock
 * on a row belonging to a different workspace.
 *
 * Must be called inside the same transaction as the invalidation sweep and the
 * new-link insert; committing between the lock and the sweep would release it.
 */
export async function lockCustomerForMagicLinkIssuance(
  tx: ProvisioningClient,
  customerId: string,
  workspaceId: string,
): Promise<void> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Customer" WHERE "id" = ${customerId} AND "workspaceId" = ${workspaceId}
    FOR UPDATE
  `;

  if (locked.length !== 1 || locked[0]!.id !== customerId) {
    // The row was resolved moments ago in this same transaction, so its absence
    // means the customer belongs to a different workspace. Same error the
    // provisioning path raises, so callers already handle it.
    throw new CustomerWorkspaceMismatchError();
  }
}

export async function findOrCreateCustomerForEmail(
  tx: ProvisioningClient,
  workspaceId: string,
  email: string,
  name: string,
): Promise<CustomerIdentity> {
  const id = randomUUID();
  const now = new Date();

  // Prisma's tagged template parameterizes every interpolated value, so the
  // email and workspace id cannot alter the statement.
  const inserted = await tx.$queryRaw<CustomerIdentity[]>`
    INSERT INTO "Customer" ("id", "workspaceId", "name", "email", "createdAt", "updatedAt")
    VALUES (${id}, ${workspaceId}, ${name}, ${email}, ${now}, ${now})
    ON CONFLICT ("workspaceId", "email") DO NOTHING
    RETURNING "id", "workspaceId", "email"
  `;

  if (inserted.length > 0) {
    return assertSameWorkspace(inserted[0]!, workspaceId);
  }

  // A concurrent request won the insert. Its transaction is necessarily
  // committed (an uncommitted conflicting row would have blocked us and then
  // either committed, making the row visible here, or rolled back, letting our
  // own INSERT succeed above), so this SELECT observes exactly one row.
  const winner = await tx.customer.findFirst({
    where: { workspaceId, email },
    select: { id: true, workspaceId: true, email: true },
  });

  if (!winner || winner.email === null) {
    throw new CustomerWorkspaceMismatchError();
  }

  return assertSameWorkspace({ id: winner.id, workspaceId: winner.workspaceId, email: winner.email }, workspaceId);
}

/**
 * Defence in depth. The conflict target already pins the workspace, so a
 * mismatch here would mean the unique index is not what this code assumes.
 */
function assertSameWorkspace(customer: CustomerIdentity, workspaceId: string): CustomerIdentity {
  if (customer.workspaceId !== workspaceId) {
    throw new CustomerWorkspaceMismatchError();
  }

  return customer;
}
