'use server';

import { revalidatePath } from 'next/cache';
import { workspaceSlugSchema } from '@/lib/workspace/slug';
import { createCustomerReply, createCustomerTicket } from '@/lib/customer-portal/server';
import {
  CustomerTicketNotFoundError,
  CustomerTicketReplyNotAllowedError,
  CustomerTicketValidationError,
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
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
