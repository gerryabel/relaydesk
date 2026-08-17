'use server';

import { getCurrentMembership, ForbiddenError } from '@/lib/workspace/server';
import { getInternalNotes, createInternalNote, TicketNotFoundError } from '@/lib/internal-notes/server';
import { createInternalNoteSchema } from '@/lib/internal-notes/schema';
import type { CreateInternalNoteInput } from '@/lib/internal-notes/schema';

export async function getInternalNotesAction(ticketId: string) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'No workspace membership found' };
    }
    return { error: 'Failed to load internal notes' };
  }

  try {
    const notes = await getInternalNotes(ticketId);
    return { success: notes };
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return { error: 'Ticket not found' };
    }
    return { error: 'Failed to load internal notes' };
  }
}

export async function createInternalNoteAction(ticketId: string, input: CreateInternalNoteInput) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'No workspace membership found' };
    }
    return { error: 'Failed to create internal note' };
  }

  const parsed = createInternalNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid internal note' };
  }

  try {
    const note = await createInternalNote(ticketId, parsed.data);
    return { success: note };
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return { error: 'Ticket not found' };
    }
    return { error: 'Failed to create internal note' };
  }
}
