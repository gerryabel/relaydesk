import { z } from 'zod';
import { ticketStatusSchema } from '@/lib/tickets/schema';
import type { TicketPriority } from '@/lib/tickets/sla';
import { CustomerTicketValidationError } from './errors';

/**
 * Customer portal ticket input validation (Phase 9 Task 2; customer reply
 * added in Task 3).
 *
 * Two properties matter more than anything else here:
 *
 *  1. Every payload is **strict**. A customer controls exactly the fields
 *     listed and nothing else. `customerId`, `workspaceId`, `priority`,
 *     `status`, `assignedToId` and any other key is rejected outright rather
 *     than silently dropped, so a caller can never believe it influenced
 *     ownership, authorship or workflow state.
 *  2. Validation is server-side and authoritative. Nothing derived from it
 *     substitutes for authorization.
 */

export const CUSTOMER_TICKET_TITLE_MAX_LENGTH = 140;
export const CUSTOMER_TICKET_DESCRIPTION_MAX_LENGTH = 5000;
export const CUSTOMER_TICKET_SEARCH_MAX_LENGTH = 200;

/**
 * The customer-safe default priority.
 *
 * Mirrors the `Ticket.priority` column default and `createTicketSchema`, so
 * a customer-created ticket and an agent-created ticket start from the same
 * baseline. Customers cannot raise or lower it themselves; agents may
 * triage afterwards through the internal workflow.
 */
export const CUSTOMER_DEFAULT_TICKET_PRIORITY: TicketPriority = 'medium';

/**
 * Customer-created tickets always start open.
 *
 * `open` is the only status a customer can produce, and it is the one the
 * internal workflow expects for a new ticket.
 */
export const CUSTOMER_DEFAULT_TICKET_STATUS = 'open' as const;

const titleSchema = z
  .string({ error: 'Title is required' })
  .trim()
  .min(1, 'Title is required')
  .max(CUSTOMER_TICKET_TITLE_MAX_LENGTH, `Title cannot exceed ${CUSTOMER_TICKET_TITLE_MAX_LENGTH} characters`);

const descriptionSchema = z
  .string({ error: 'Description must be text' })
  .max(
    CUSTOMER_TICKET_DESCRIPTION_MAX_LENGTH,
    `Description cannot exceed ${CUSTOMER_TICKET_DESCRIPTION_MAX_LENGTH} characters`,
  )
  .transform((value) => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

/**
 * The complete set of customer-controlled create-ticket fields.
 *
 * `strictObject` (not `object`) is load-bearing: it turns an attempt to
 * smuggle `customerId` or `workspaceId` into a `400` instead of quietly
 * ignoring it, which keeps the request/response contract honest.
 *
 * `description` defaults to `null` rather than `undefined` so "the customer
 * said nothing" is one representable value all the way to the insert, instead
 * of the service having to tell `undefined` and `null` apart.
 */
export const createCustomerTicketSchema = z.strictObject({
  title: titleSchema,
  description: descriptionSchema.nullish().default(null),
});

/** Longest customer reply body. Matches the agent-side message limit. */
export const CUSTOMER_REPLY_BODY_MAX_LENGTH = 5000;

/**
 * Most attachments a single customer message may carry (Phase 9 Task 4).
 *
 * This lives here, beside the other customer-facing limits, rather than in
 * `attachments.ts`. The reply form is a client component, and `attachments.ts`
 * imports `node:crypto`, the Prisma client and the filesystem-backed storage
 * provider — importing the number from there dragged the whole server module
 * into the browser bundle and failed the build on `node:fs`. A constant that a
 * client component needs must not live in a server-only module.
 *
 * The *enforcement* is still entirely server-side, in the service and the
 * action; this is only the number, so the form can disable its own submit
 * button early rather than discovering the limit from a round trip.
 */
export const CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT = 10;

/**
 * The complete set of customer-controlled reply fields: exactly one.
 *
 * `strictObject` is what makes "a customer cannot change ticket status, cannot
 * claim authorship of someone else's message and cannot set `firstResponseAt`"
 * true rather than aspirational — each of those keys is a validation error, not
 * a dropped field.
 *
 * `ticketId` is **not** part of this object. It arrives as a route parameter
 * and is scoped by ownership in the query, so it is never a value a request
 * body can contradict.
 */
export const createCustomerReplySchema = z.strictObject({
  body: z
    .string({ error: 'Message must be text' })
    .trim()
    .min(1, 'Message cannot be empty')
    .max(
      CUSTOMER_REPLY_BODY_MAX_LENGTH,
      `Message cannot exceed ${CUSTOMER_REPLY_BODY_MAX_LENGTH} characters`,
    ),
});

/** Query parameters for the customer ticket list. */
export const customerTicketListQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(CUSTOMER_TICKET_SEARCH_MAX_LENGTH, `Search cannot exceed ${CUSTOMER_TICKET_SEARCH_MAX_LENGTH} characters`)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  status: ticketStatusSchema.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type CreateCustomerTicketInput = z.infer<typeof createCustomerTicketSchema>;
export type CreateCustomerReplyInput = z.infer<typeof createCustomerReplySchema>;
export type CustomerTicketListQuery = z.infer<typeof customerTicketListQuerySchema>;

/**
 * Parses `createCustomerTicketSchema`, re-throwing a portal-safe error.
 *
 * The HTTP and server-action layers both need to distinguish "the customer
 * sent something invalid" (→ `400`) from "the database blew up" (→ generic
 * `500`), and the raw `ZodError` carries stack/SQL-adjacent structure that
 * must never be serialized directly.
 */
export function parseCreateCustomerTicketInput(rawInput: unknown): CreateCustomerTicketInput {
  const parsed = createCustomerTicketSchema.safeParse(rawInput ?? {});

  if (parsed.success) {
    return parsed.data;
  }

  throw toCustomerTicketValidationError(parsed.error);
}

/** Same contract as {@link parseCreateCustomerTicketInput}, for list queries. */
export function parseCustomerTicketListQuery(rawInput: unknown): CustomerTicketListQuery {
  const parsed = customerTicketListQuerySchema.safeParse(rawInput ?? {});

  if (parsed.success) {
    return parsed.data;
  }

  throw toCustomerTicketValidationError(parsed.error);
}

/** Same contract as {@link parseCreateCustomerTicketInput}, for customer replies. */
export function parseCreateCustomerReplyInput(rawInput: unknown): CreateCustomerReplyInput {
  const parsed = createCustomerReplySchema.safeParse(rawInput ?? {});

  if (parsed.success) {
    return parsed.data;
  }

  throw toCustomerTicketValidationError(parsed.error);
}

function toCustomerTicketValidationError(error: z.ZodError): CustomerTicketValidationError {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (fieldErrors[key] ??= []).push(issue.message);
  }

  return new CustomerTicketValidationError(
    error.issues[0]?.message ?? 'Invalid request',
    fieldErrors,
  );
}

/**
 * Search term used against customer-owned tickets.
 *
 * Returned as `undefined` for blank input so the query builder omits the
 * clause entirely instead of matching on an empty string.
 */
export function normalizeCustomerTicketSearch(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Reads one search parameter, collapsing "absent" and "empty" to `undefined`.
 *
 * `?page=` must not become `Number('')` → `0` and then a validation failure
 * for a link the portal itself generated.
 */
export function readCustomerTicketParam(
  value: string | string[] | undefined,
): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;

  if (typeof single !== 'string') {
    return undefined;
  }

  const trimmed = single.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

/** The exact parameter names the list endpoint accepts. */
export const CUSTOMER_TICKET_LIST_PARAMS = ['q', 'status', 'page', 'limit'] as const;

/**
 * Reduces an untrusted query string to the four parameters the list accepts.
 *
 * Both entry points that read a customer's ticket list — the REST route and
 * the server-rendered list page — normalize through here, so "which keys are
 * forwarded" is one answer instead of two. Anything outside the allowlist is
 * dropped rather than rejected, because a page URL may legitimately carry
 * Next.js bookkeeping parameters (`_rsc`, tracking tags) that a customer can
 * add to a copied link; dropping them is correct and failing on them is not.
 *
 * `customerTicketListQuerySchema` stays strict, so a service caller that
 * hand-builds a params object still cannot smuggle an unknown key past it.
 */
export function normalizeCustomerTicketListParams(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};

  for (const key of CUSTOMER_TICKET_LIST_PARAMS) {
    params[key] = readCustomerTicketParam(raw[key]);
  }

  return params;
}
