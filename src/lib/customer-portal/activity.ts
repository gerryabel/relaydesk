/**
 * Customer-visible ticket activity (Phase 9 Task 2, extended in Task 3).
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
 *    and, for most types, the before/after values of internal fields.
 *    Aggregating it wholesale for a customer would disclose who is working on
 *    the ticket and what they changed.
 *
 * So customer-visible activity is derived from exactly three sources:
 *
 *   1. the ticket's own creation time,
 *   2. the timestamps of its customer-visible `Message` records, and
 *   3. `STATUS_CHANGED` rows in `TicketActivity`.
 *
 * Source 3 is the one activity type a customer is allowed to know about: the
 * status is displayed to them in the portal and emailed to them on change, so
 * its timestamp is not a disclosure. Every *other* activity type — assignment,
 * tagging, priority changes, internal notes, automation — stays excluded,
 * because `TicketActivity` also records the actor id and internal before/after
 * values. The type filter lives in the query that loads them, not in a
 * post-filter here, so the actor column is never even fetched.
 */

/**
 * Picks the customer-visible activity time for a ticket.
 *
 * The latest of the ticket's creation time, its newest customer-visible
 * message and its newest customer-visible status change. Exported so that
 * "last activity" has exactly one definition in the codebase.
 *
 * `null`/`undefined` means "no messages"/"no status change", which is an
 * ordinary state rather than an error, so callers never special-case it.
 */
export function resolveLastVisibleActivity(
  createdAt: Date,
  latestMessageAt: Date | null | undefined,
  latestStatusChangeAt?: Date | null,
): Date {
  const candidates = [createdAt, latestMessageAt, latestStatusChangeAt].filter(
    (value): value is Date => value !== null && value !== undefined,
  );

  let latest = createdAt;

  for (const candidate of candidates) {
    // `>` rather than `>=` so a timestamp that ties the creation time still
    // reports the creation time; the value is identical either way, and
    // preferring the ticket's own timestamp keeps the source stable.
    if (candidate.getTime() > latest.getTime()) {
      latest = candidate;
    }
  }

  return latest;
}

/**
 * Collapses grouped `MAX(Message.createdAt)` and `MAX(TicketActivity.createdAt)`
 * results into a per-ticket lookup, defaulting each ticket to its own creation
 * time.
 *
 * Missing entries mean "no messages"/"no status change", which is the ticket's
 * creation time.
 */
export function buildLastVisibleActivityMap(
  tickets: Array<{ id: string; createdAt: Date }>,
  latestMessageByTicket: ReadonlyMap<string, Date>,
  latestStatusChangeByTicket: ReadonlyMap<string, Date> = new Map(),
): Map<string, Date> {
  const result = new Map<string, Date>();

  for (const ticket of tickets) {
    result.set(
      ticket.id,
      resolveLastVisibleActivity(
        ticket.createdAt,
        latestMessageByTicket.get(ticket.id),
        latestStatusChangeByTicket.get(ticket.id),
      ),
    );
  }

  return result;
}
