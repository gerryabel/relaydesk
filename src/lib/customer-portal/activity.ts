/**
 * Customer-visible ticket activity (Phase 9 Task 2).
 *
 * The portal must not let a customer infer internal operations. Two
 * timestamp fields on `Ticket` would do exactly that if used naively:
 *
 *  - `updatedAt` is `@updatedAt`, so it moves on assignment, priority
 *    changes, tag add/remove, customer link/unlink and any write at all.
 *    A customer watching it would see their ticket "change" every time an
 *    agent touched something they cannot see, which leaks the fact that
 *    internal work is happening.
 *  - `TicketActivity` is an internal audit log that records the *actor id*
 *    and, for some types, the before/after values of internal fields.
 *    Aggregating it for a customer would disclose who is working on the
 *    ticket and what they changed.
 *
 * So customer-visible activity is derived from exactly two sources:
 *
 *   1. the ticket's own creation time, and
 *   2. the timestamps of its customer-visible `Message` records.
 *
 * That is the complete customer-visible history under the current message
 * model. Task 3 adds customer-authored messages and a `ticket.status_changed`
 * customer-visible signal; both are new *sources*, not a change to the rule,
 * so they extend `lastVisibleActivityAt` rather than replacing it.
 */

/**
 * Picks the customer-visible activity time for a ticket.
 *
 * The later of the ticket's creation time and the newest customer-visible
 * message. This is the complete rule, exported so that a future Task 3 change
 * has to go through this one function rather than quietly redefining
 * "last activity" somewhere else.
 *
 * `null`/`undefined` means "no messages", which is a ticket nobody has replied
 * to — an ordinary state, not an error — so callers never have to special-case
 * it.
 */
export function resolveLastVisibleActivity(
  createdAt: Date,
  latestMessageAt: Date | null | undefined,
): Date {
  if (latestMessageAt === null || latestMessageAt === undefined) {
    return createdAt;
  }

  // `>` rather than `>=` so a message timestamp that ties the creation time
  // still reports the creation time; the value is identical either way, and
  // preferring the ticket's own timestamp keeps the source stable.
  return latestMessageAt.getTime() > createdAt.getTime() ? latestMessageAt : createdAt;
}

/**
 * Collapses a `groupBy` result of `MAX(Message.createdAt)` into a per-ticket
 * lookup, defaulting each ticket to its own creation time.
 *
 * Missing entries mean "no messages", which is the ticket's creation time.
 */
export function buildLastVisibleActivityMap(
  tickets: Array<{ id: string; createdAt: Date }>,
  latestMessageByTicket: ReadonlyMap<string, Date>,
): Map<string, Date> {
  const result = new Map<string, Date>();

  for (const ticket of tickets) {
    result.set(ticket.id, resolveLastVisibleActivity(ticket.createdAt, latestMessageByTicket.get(ticket.id)));
  }

  return result;
}
