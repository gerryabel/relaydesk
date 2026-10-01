'use server';

import { revalidatePath } from 'next/cache';
import { workspaceSlugSchema } from '@/lib/workspace/slug';
import { createCustomerReply, createCustomerTicket } from '@/lib/customer-portal/server';
import { uploadCustomerAttachment } from '@/lib/customer-portal/attachments';
import { CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT } from '@/lib/customer-portal/schema';
import {
  CustomerTicketNotFoundError,
  CustomerTicketReplyNotAllowedError,
  CustomerTicketValidationError,
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
  CustomerAttachmentNotFoundError,
  CustomerAttachmentValidationError,
} from '@/lib/customer-portal/errors';
import type { CustomerMessageView, CustomerTicketDetail } from '@/lib/customer-portal/dto';

/**
 * Customer portal server actions (Phase 9 Task 2; customer reply in Task 3).
 *
 * Only mutations live here. Reads happen in server components, which already
 * have a resolved session; an action that merely forwarded a read would add a
 * round trip and a second way to forget a check.
 *
 * The action re-derives identity from the customer session exactly like the
 * API routes do. The slug and ticket id it receives are validated and then
 * used only to resolve the workspace and scope the query — never to decide
 * who the caller is.
 */

export type CreateCustomerTicketActionResult =
  | { success: true; ticket: CustomerTicketDetail }
  | { error: string };

export type CreateCustomerReplyActionResult =
  | { success: true; message: CustomerMessageView }
  | { error: string };

export type CreateCustomerReplyWithAttachmentsActionResult =
  | {
      success: true;
      message: CustomerMessageView;
      /** Files that were stored. Not returned in full — the DTO has no key. */
      storedCount: number;
      /**
       * Files that could not be stored, by display name.
       *
       * Reported rather than swallowed: the reply is already persisted and
       * visible, so silently dropping a file would tell the customer "sent"
       * for something that was not.
       */
      failed: Array<{ filename: string; reason: string }>;
    }
  | { error: string };

export async function createCustomerTicketAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CreateCustomerTicketActionResult> {
  const slug = workspaceSlugSchema.safeParse(workspaceSlug);

  if (!slug.success) {
    return { error: 'Invalid request' };
  }

  try {
    const { ticket } = await createCustomerTicket({ workspaceSlug: slug.data, rawInput: input });

    revalidatePath(`/portal/${slug.data}/tickets`);

    return { success: true, ticket };
  } catch (error) {
    if (error instanceof CustomerTicketValidationError) {
      return { error: error.message };
    }

    // The page redirects unauthenticated visitors before this can run, so this
    // branch means the session expired mid-flight rather than that the customer
    // is simply signed out.
    if (
      error instanceof CustomerUnauthenticatedError ||
      error instanceof CustomerWorkspaceMismatchError
    ) {
      return { error: 'Your sign-in session has expired. Please sign in again.' };
    }

    // Deliberately opaque: a database, SLA-policy or outbox failure must not
    // tell a customer anything about the workspace internals.
    return { error: 'We could not create your ticket right now. Please try again.' };
  }
}

/**
 * Posts a customer reply to a ticket.
 *
 * Both detail and list paths are revalidated: the conversation grows on the
 * detail page, and the ticket's `lastActivityAt` moves, so the "My tickets"
 * list would otherwise keep showing a stale ordering until navigation.
 */
export async function createCustomerReplyAction(
  workspaceSlug: string,
  ticketId: string,
  input: unknown,
): Promise<CreateCustomerReplyActionResult> {
  const slug = workspaceSlugSchema.safeParse(workspaceSlug);

  if (!slug.success || typeof ticketId !== 'string' || ticketId.trim().length === 0) {
    return { error: 'Invalid request' };
  }

  try {
    const { message } = await createCustomerReply({
      workspaceSlug: slug.data,
      ticketId,
      rawInput: input,
    });

    revalidatePath(`/portal/${slug.data}/tickets`);
    revalidatePath(`/portal/${slug.data}/tickets/${ticketId}`);

    return { success: true, message };
  } catch (error) {
    if (error instanceof CustomerTicketValidationError) {
      return { error: error.message };
    }

    if (error instanceof CustomerTicketReplyNotAllowedError) {
      return { error: error.message };
    }

    // A ticket that is missing, or owned by somebody else, produces the same
    // message the detail page would show rather than revealing that it exists.
    if (error instanceof CustomerTicketNotFoundError) {
      return { error: 'Ticket not found.' };
    }

    if (
      error instanceof CustomerUnauthenticatedError ||
      error instanceof CustomerWorkspaceMismatchError
    ) {
      return { error: 'Your sign-in session has expired. Please sign in again.' };
    }

    return { error: 'We could not send your reply right now. Please try again.' };
  }
}

/**
 * Posts a customer reply with its attachments (Phase 9 Task 4).
 *
 * Why this is a server action rather than "POST the reply, then POST each file
 * from the browser":
 *
 * The upload endpoint addresses an attachment by
 * `{ticketId}/messages/{messageId}`, so the browser would need the raw message
 * id of the reply it just created. Task 3 deliberately keeps raw message ids out
 * of every customer payload, and re-exposing one so the browser could complete
 * a round trip would trade a Task 3 invariant for a convenience. Doing the
 * upload server-side keeps the id where it already is.
 *
 * Ordering is reply-first, then attachments, for the same reason the UI does it:
 * the reply is the record of what the customer said, and it is the thing they
 * must not lose to a file error. A file that fails is reported individually; the
 * reply and every other file still land.
 *
 * Authorization is unchanged and not reimplemented here: the reply goes through
 * `createCustomerReply` and each file through `uploadCustomerAttachment`, both of
 * which re-derive `(workspaceId, customerId)` from the session. This action adds
 * no query of its own and accepts no identity parameter.
 *
 * Failures are per-file, not all-or-nothing, and they are surfaced: the result
 * carries `failed` with a reason per file, and the caller is expected to render
 * it. There is no customer delete path in Task 4, so a partially-stored set is
 * permanent by design — which is why the count is bounded by
 * {@link CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT} and why silent loss is not an
 * option.
 */
export async function createCustomerReplyWithAttachmentsAction(
  workspaceSlug: string,
  ticketId: string,
  input: unknown,
  files: readonly File[],
): Promise<CreateCustomerReplyWithAttachmentsActionResult> {
  const slug = workspaceSlugSchema.safeParse(workspaceSlug);

  if (!slug.success || typeof ticketId !== 'string' || ticketId.trim().length === 0) {
    return { error: 'Invalid request' };
  }

  if (files.length > CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT) {
    return {
      error: `A message can have at most ${CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT} attachments.`,
    };
  }

  let message: CustomerMessageView;
  let messageId: string;

  try {
    const created = await createCustomerReply({
      workspaceSlug: slug.data,
      ticketId,
      rawInput: input,
    });

    message = created.message;
    messageId = created.messageId;
  } catch (error) {
    return mapReplyFailure(error);
  }

  const failed: Array<{ filename: string; reason: string }> = [];
  let storedCount = 0;

  // Sequential rather than parallel: a handful of files at 10 MB each will
  // exhaust the server action's request budget if they all buffer at once, and
  // ordering the writes keeps the activity timeline readable.
  for (const file of files) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());

      await uploadCustomerAttachment({
        workspaceSlug: slug.data,
        ticketId,
        messageId,
        declaredFilename: file.name,
        declaredMimeType: file.type,
        buffer,
      });

      storedCount += 1;
    } catch (error) {
      failed.push({ filename: file.name, reason: describeAttachmentFailure(error) });
    }
  }

  revalidatePath(`/portal/${slug.data}/tickets`);
  revalidatePath(`/portal/${slug.data}/tickets/${ticketId}`);

  return { success: true, message, storedCount, failed };
}

/**
 * Shared error translation for the reply actions.
 *
 * `CustomerTicketValidationError` and `CustomerTicketReplyNotAllowedError`
 * already carry portal-safe literals. Everything else collapses to a generic
 * sentence, and the file name is never echoed: it is customer-supplied and would
 * put unvalidated text back on the page.
 */
function mapReplyFailure(error: unknown): { error: string } {
  if (error instanceof CustomerTicketValidationError) {
    return { error: error.message };
  }

  if (error instanceof CustomerTicketReplyNotAllowedError) {
    return { error: error.message };
  }

  // A ticket that is missing, or owned by somebody else, produces the same
  // message the detail page would show rather than revealing that it exists.
  if (error instanceof CustomerTicketNotFoundError) {
    return { error: 'Ticket not found.' };
  }

  if (
    error instanceof CustomerUnauthenticatedError ||
    error instanceof CustomerWorkspaceMismatchError
  ) {
    return { error: 'Your sign-in session has expired. Please sign in again.' };
  }

  return { error: 'We could not send your reply right now. Please try again.' };
}

/**
 * Turns one file's failure into a sentence safe to render.
 *
 * Only the two attachment classes that describe the *customer's* request are
 * rendered verbatim; a storage or database failure becomes a generic message,
 * because the real cause names paths and constraint violations.
 */
function describeAttachmentFailure(error: unknown): string {
  if (error instanceof CustomerAttachmentValidationError) {
    return error.message;
  }

  // Deliberately the same sentence as an unknown attachment: from the customer's
  // side, "that file cannot go there" must not confirm the message exists.
  if (error instanceof CustomerAttachmentNotFoundError) {
    return 'That file could not be attached to this reply.';
  }

  return 'That file could not be stored. Please try again.';
}
