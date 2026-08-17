'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentMembership, ForbiddenError } from '@/lib/workspace/server';
import { bulkUpdateTickets } from '@/lib/tickets/bulk';
import { BulkTicketIdsRequiredError, BulkTicketLimitExceededError, BulkDuplicateTicketIdsError, BulkActionNotSupportedError, BulkAssigneeNotInWorkspaceError, BulkInvalidTransitionError, BulkTagNotFoundError, BulkTagNotInWorkspaceError } from '@/lib/tickets/bulk';
import type { BulkActionInput, BulkUpdateResult } from '@/lib/tickets/bulk';

export async function bulkUpdateTicketsAction(payload: BulkActionInput): Promise<BulkUpdateResult> {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      throw new Error('No workspace membership found');
    }

    throw error;
  }

  const result = await bulkUpdateTickets(payload);
  revalidatePath('/dashboard/tickets');

  return result;
}

export function serializeBulkUpdateError(error: unknown): { message: string } {
  if (error instanceof BulkTicketIdsRequiredError || error instanceof BulkTicketLimitExceededError || error instanceof BulkDuplicateTicketIdsError || error instanceof BulkActionNotSupportedError || error instanceof BulkAssigneeNotInWorkspaceError || error instanceof BulkInvalidTransitionError || error instanceof BulkTagNotFoundError || error instanceof BulkTagNotInWorkspaceError) {
    return { message: error.message };
  }

  return { message: 'Aksi gagal diterapkan.' };
}
