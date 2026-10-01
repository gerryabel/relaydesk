import { z } from 'zod';
import { createOutboxEvent, type CreateOutboxEventInput } from '@/lib/outbox/outbox';
import { ticketStatusSchema } from '@/lib/tickets/schema';
import type { Prisma } from '@/generated/prisma';

/**
 * Customer email events (Phase 9 Task 3).
 *
 * Two customer-visible moments are worth an email:
 *
 *  - `TICKET_REPLIED`  — an agent posted a reply on a ticket that has a
 *    customer. (Reused from the existing event vocabulary rather than
 *    invented; nothing produced it before Task 3.)
 *  - `TICKET_STATUS_CHANGED` — a ticket's status moved, and the customer
 *    should see it in their portal even if they never open it.
 *
 * Design rules that this module exists to enforce:
 *
 *  1. **Identifiers only.** A payload carries ids, never an address, subject
 *     or body. Everything a customer reads is rendered in the worker from
 *     freshly read database state, so an event queued before a customer was
 *     unlinked cannot mail a stranger, and a renamed ticket cannot produce an
 *     email whose subject contradicts the portal. `strictObject` rather than
 *     `object` makes that rule enforced: an unexpected key — a smuggled `to` or
 *     `subject` — is a failed parse at write time, not a silently dropped
 *     field that hides a future mistake.
 *  2. **Same transaction as the state change.** Both helpers take the caller's
 *     `Prisma.TransactionClient`, so a ticket update, its `STATUS_CHANGED`
 *     activity row and this event commit or roll back together.
 *  3. **No event without a customer.** Callers pass `customerId` only when a
 *     customer is linked; there is no "notify everyone" branch.
 */

/** Payload for `TICKET_REPLIED`. */
export const customerReplyEmailPayloadSchema = z.strictObject({
  workspaceId: z.string().min(1),
  ticketId: z.string().min(1),
  /** The customer the reply was addressed to at write time. */
  customerId: z.string().min(1),
  /** Agent message that triggered the notification. */
  messageId: z.string().min(1),
});

/** Payload for `TICKET_STATUS_CHANGED`. */
export const customerStatusChangedEmailPayloadSchema = z.strictObject({
  workspaceId: z.string().min(1),
  ticketId: z.string().min(1),
  customerId: z.string().min(1),
  fromStatus: ticketStatusSchema,
  toStatus: ticketStatusSchema,
});

export type CustomerReplyEmailPayload = z.infer<typeof customerReplyEmailPayloadSchema>;
export type CustomerStatusChangedEmailPayload = z.infer<typeof customerStatusChangedEmailPayloadSchema>;

export const CUSTOMER_EMAIL_EVENT_TYPES = ['TICKET_REPLIED', 'TICKET_STATUS_CHANGED'] as const;

export type CustomerEmailEventType = (typeof CUSTOMER_EMAIL_EVENT_TYPES)[number];

export interface QueueCustomerReplyEmailInput {
  workspaceId: string;
  ticketId: string;
  customerId: string | null;
  messageId: string;
}

/**
 * Queues the "an agent replied" customer email.
 *
 * A no-op when `customerId` is null: an internal-only ticket has nobody to
 * notify, and inventing a notification for one is how customer-facing mail
 * starts leaking to the wrong inbox.
 */
export async function queueCustomerReplyEmail(
  tx: Prisma.TransactionClient,
  input: QueueCustomerReplyEmailInput,
): Promise<void> {
  if (!input.customerId) {
    return;
  }

  const payload = customerReplyEmailPayloadSchema.parse({
    workspaceId: input.workspaceId,
    ticketId: input.ticketId,
    customerId: input.customerId,
    messageId: input.messageId,
  });

  await createOutboxEvent(
    {
      eventType: 'TICKET_REPLIED',
      aggregateType: 'Ticket',
      aggregateId: payload.ticketId,
      payload: payload as CreateOutboxEventInput['payload'],
    },
    tx,
  );
}

export interface QueueCustomerStatusChangedEmailInput {
  workspaceId: string;
  ticketId: string;
  /** Customer linked to the ticket *after* the update. */
  customerId: string | null;
  fromStatus: z.infer<typeof ticketStatusSchema>;
  toStatus: z.infer<typeof ticketStatusSchema>;
}

/**
 * Queues the "your ticket changed status" customer email.
 *
 * Callers must skip the call entirely when the status did not actually
 * change; `fromStatus === toStatus` is rejected here as a defensive measure so
 * a future no-op path cannot spam a customer.
 */
export async function queueCustomerStatusChangedEmail(
  tx: Prisma.TransactionClient,
  input: QueueCustomerStatusChangedEmailInput,
): Promise<void> {
  if (!input.customerId) {
    return;
  }

  if (input.fromStatus === input.toStatus) {
    return;
  }

  const payload = customerStatusChangedEmailPayloadSchema.parse({
    workspaceId: input.workspaceId,
    ticketId: input.ticketId,
    customerId: input.customerId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
  });

  await createOutboxEvent(
    {
      eventType: 'TICKET_STATUS_CHANGED',
      aggregateType: 'Ticket',
      aggregateId: payload.ticketId,
      payload: payload as CreateOutboxEventInput['payload'],
    },
    tx,
  );
}
