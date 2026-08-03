'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentMembership, ForbiddenError } from '@/lib/workspace/server';
import { createTicket, getTicketById, updateTicket, closeTicket, TicketNotFoundError } from '@/lib/tickets/server';
import { createTicketSchema, updateTicketSchema } from '@/lib/tickets/schema';
import type { CreateTicketInput, UpdateTicketInput } from '@/lib/tickets/schema';

export async function createTicketAction(input: CreateTicketInput) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'No workspace membership found' };
    }
    return { error: 'Failed to create ticket' };
  }

  const parsed = createTicketSchema.safeParse(input);

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid ticket data' };
  }

  try {
    const ticket = await createTicket(parsed.data);
    revalidatePath('/dashboard/tickets');
    return { success: ticket };
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return { error: 'Ticket not found' };
    }
    return { error: 'Failed to create ticket' };
  }
}

export async function updateTicketAction(id: string, input: UpdateTicketInput) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'No workspace membership found' };
    }
    return { error: 'Failed to update ticket' };
  }

  const parsed = updateTicketSchema.safeParse(input);

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid ticket data' };
  }

  try {
    const ticket = await updateTicket(id, parsed.data);
    revalidatePath('/dashboard/tickets');
    revalidatePath(`/dashboard/tickets/${id}`);
    return { success: ticket };
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return { error: 'Ticket not found' };
    }
    return { error: 'Failed to update ticket' };
  }
}

export async function closeTicketAction(id: string) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'No workspace membership found' };
    }
    return { error: 'Failed to close ticket' };
  }

  try {
    const ticket = await closeTicket(id);
    revalidatePath('/dashboard/tickets');
    revalidatePath(`/dashboard/tickets/${id}`);
    return { success: ticket };
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return { error: 'Ticket not found' };
    }
    return { error: 'Failed to close ticket' };
  }
}

export async function getTicketDetailAction(id: string) {
  try {
    return await getTicketById(id);
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return null;
    }
    throw error;
  }
}
