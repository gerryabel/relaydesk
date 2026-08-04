'use server';

import { getCurrentMembership, ForbiddenError } from '@/lib/workspace/server';
import { createMessage, getMessages, TicketNotFoundError } from '@/lib/messages/server';
import { createMessageSchema } from '@/lib/messages/schema';
import type { CreateMessageInput } from '@/lib/messages/schema';

export async function getMessagesAction(ticketId: string) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'No workspace membership found' };
    }
    return { error: 'Failed to load messages' };
  }

  try {
    const messages = await getMessages(ticketId);
    return { success: messages };
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return { error: 'Ticket not found' };
    }
    return { error: 'Failed to load messages' };
  }
}

export async function createMessageAction(ticketId: string, input: CreateMessageInput) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'No workspace membership found' };
    }
    return { error: 'Failed to create message' };
  }

  const parsed = createMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid message' };
  }

  try {
    const message = await createMessage(ticketId, parsed.data);
    return { success: message };
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return { error: 'Ticket not found' };
    }
    return { error: 'Failed to create message' };
  }
}
