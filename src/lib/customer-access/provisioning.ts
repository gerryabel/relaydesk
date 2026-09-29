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
