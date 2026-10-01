/**
 * Message authorship contract (Phase 9 Task 3).
 *
 * `Message.authorType` is only trustworthy if the writer, the ORM schema and
 * the database agree on what each value means. This module is the single
 * place that states the mapping and asserts it, so a future writer cannot
 * invent a fourth combination:
 *
 *   | authorType | createdById | customerId |
 *   |------------|-------------|------------|
 *   | agent      | required    | must be null |
 *   | customer   | must be null| required    |
 *   | system     | must be null| must be null |
 *
 * The same three rules are enforced in PostgreSQL by the named CHECK
 * constraints `message_author_agent` / `message_author_customer` /
 * `message_author_system` (see the Task 3 migration). These helpers exist for
 * the cases the database cannot catch — a service that builds the wrong write
 * shape in a unit test, or a Prisma client mock with no constraint behind it.
 */

import { z } from 'zod';

export const messageAuthorTypeSchema = z.enum(['agent', 'customer', 'system']);

export type MessageAuthorType = z.infer<typeof messageAuthorTypeSchema>;

/**
 * The foreign keys each author type is allowed to carry.
 *
 * `null` means "must not be set"; a string means "must be set".
 */
export const MESSAGE_AUTHOR_KEYS: Record<
  MessageAuthorType,
  { createdById: 'required' | 'forbidden'; customerId: 'required' | 'forbidden' }
> = {
  agent: { createdById: 'required', customerId: 'forbidden' },
  customer: { createdById: 'forbidden', customerId: 'required' },
  system: { createdById: 'forbidden', customerId: 'forbidden' },
};

/**
 * Write shape for a message, before any `ticketId`/`id` is assigned.
 *
 * Used by the agent service and the customer reply service so both build the
 * same discriminated union rather than two hand-rolled objects.
 */
export type MessageAuthorWrite = {
  authorType: MessageAuthorType;
  createdById: string | null;
  customerId: string | null;
};

export type MessageAuthorshipErrorCode =
  | 'invalid_author_type'
  | 'missing_agent_author'
  | 'unexpected_agent_customer'
  | 'unexpected_customer_agent'
  | 'missing_customer_author'
  | 'unexpected_system_agent'
  | 'unexpected_system_customer';

const VALIDATION_MESSAGES: Record<MessageAuthorType, string> = {
  agent: 'Agent-authored messages require a createdById.',
  customer: 'Customer-authored messages require a customerId.',
  system: 'System-authored messages cannot have an author.',
};

/**
 * Thrown when a write shape violates the authorship contract.
 *
 * Deliberately not a `zod` error: this is a programming error at a write site,
 * not user input, so it is raised as a distinct class the services let bubble
 * up rather than converting into a 400.
 */
export class MessageAuthorshipError extends Error {
  readonly code: MessageAuthorshipErrorCode;
  readonly authorType: MessageAuthorType;

  constructor(code: MessageAuthorshipErrorCode, authorType: MessageAuthorType) {
    super(`${VALIDATION_MESSAGES[authorType]} (${code})`);
    this.name = 'MessageAuthorshipError';
    this.code = code;
    this.authorType = authorType;
  }
}

/**
 * Asserts a write shape satisfies the authorship invariant.
 *
 * Throws {@link MessageAuthorshipError} with a specific code so a failing test
 * states which half of the rule broke.
 */
export function assertMessageAuthor(write: MessageAuthorWrite): void {
  if (write.authorType === 'agent') {
    if (write.createdById === null) {
      throw new MessageAuthorshipError('missing_agent_author', 'agent');
    }
    if (write.customerId !== null) {
      throw new MessageAuthorshipError('unexpected_agent_customer', 'agent');
    }
    return;
  }

  if (write.authorType === 'customer') {
    if (write.customerId === null) {
      throw new MessageAuthorshipError('missing_customer_author', 'customer');
    }
    if (write.createdById !== null) {
      throw new MessageAuthorshipError('unexpected_customer_agent', 'customer');
    }
    return;
  }

  if (write.createdById !== null) {
    throw new MessageAuthorshipError('unexpected_system_agent', 'system');
  }
  if (write.customerId !== null) {
    throw new MessageAuthorshipError('unexpected_system_customer', 'system');
  }
}

/** Narrows an unknown author type, for DTO boundaries. */
export function isMessageAuthorType(value: unknown): value is MessageAuthorType {
  return messageAuthorTypeSchema.safeParse(value).success;
}
