'use server';

import { revalidatePath } from 'next/cache';
import { workspaceSlugSchema } from '@/lib/workspace/slug';
import { createCustomerTicket } from '@/lib/customer-portal/server';
import {
  CustomerTicketValidationError,
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
} from '@/lib/customer-portal/errors';
import type { CustomerTicketDetail } from '@/lib/customer-portal/dto';

/**
 * Customer portal server actions (Phase 9 Task 2).
 *
 * Only the one mutation Task 2 supports lives here. Reads happen in server
 * components, which already have a resolved session; an action that merely
 * forwarded a read would add a round trip and a second way to forget a check.
 *
 * The action re-derives identity from the customer session exactly like the
 * API routes do. The slug it receives is validated and then used only to
 * resolve the workspace — never to decide who the caller is.
 */

export type CreateCustomerTicketActionResult =
  | { success: true; ticket: CustomerTicketDetail }
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
