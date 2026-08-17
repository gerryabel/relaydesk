'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentMembership, ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { createTagSchema, updateTagSchema, type CreateTagInput, type UpdateTagInput } from '@/lib/tags/schema';
import { createTag, getTags, updateTag, deleteTag, addTagToTicket, removeTagFromTicket, TagNotFoundError, DuplicateTagError, TicketTagAlreadyExistsError, TicketTagNotFoundError } from '@/lib/tags/server';
import { TicketNotFoundError } from '@/lib/tickets/server';

export async function createTagAction(input: CreateTagInput) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'Forbidden' };
    }
    return { error: 'Unauthorized' };
  }

  const parsed = createTagSchema.safeParse(input);

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid tag data' };
  }

  try {
    const tag = await createTag(parsed.data);
    return { data: tag };
  } catch (error) {
    if (error instanceof DuplicateTagError) {
      return { error: 'Tag dengan nama yang sama sudah ada di workspace ini.' };
    }
    if (error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' };
    }
    return { error: 'Failed to create tag' };
  }
}

export async function updateTagAction(id: string, input: UpdateTagInput) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'Forbidden' };
    }
    return { error: 'Unauthorized' };
  }

  const parsed = updateTagSchema.safeParse(input);

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid tag data' };
  }

  try {
    const tag = await updateTag(id, parsed.data);
    return { data: tag };
  } catch (error) {
    if (error instanceof TagNotFoundError) {
      return { error: 'Tag tidak ditemukan.' };
    }
    if (error instanceof DuplicateTagError) {
      return { error: 'Tag dengan nama yang sama sudah ada di workspace ini.' };
    }
    if (error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' };
    }
    return { error: 'Failed to update tag' };
  }
}

export async function deleteTagAction(id: string) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'Forbidden' };
    }
    return { error: 'Unauthorized' };
  }

  try {
    await deleteTag(id);
    revalidatePath('/dashboard/tags');
    revalidatePath('/dashboard/tickets');
    return { data: { ok: true } };
  } catch (error) {
    if (error instanceof TagNotFoundError) {
      return { error: 'Tag tidak ditemukan.' };
    }
    if (error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' };
    }
    return { error: 'Failed to delete tag' };
  }
}

export async function getTagsAction() {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'Forbidden' };
    }
    return { error: 'Unauthorized' };
  }

  try {
    const tags = await getTags();
    return { data: tags };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { error: 'Unauthorized' };
    }
    if (error instanceof ForbiddenError) {
      return { error: 'Forbidden' };
    }
    return { error: 'Failed to load tags' };
  }
}

export async function addTicketTagAction(ticketId: string, tagId: string) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'Forbidden' };
    }
    return { error: 'Unauthorized' };
  }

  try {
    await addTagToTicket(ticketId, tagId);
    revalidatePath('/dashboard/tickets');
    revalidatePath(`/dashboard/tickets/${ticketId}`);
    return { data: { ok: true } };
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return { error: 'Ticket not found' };
    }
    if (error instanceof TagNotFoundError) {
      return { error: 'Tag not found' };
    }
    if (error instanceof TicketTagAlreadyExistsError) {
      return { error: 'Tiket sudah memiliki tag ini.' };
    }
    return { error: 'Failed to add ticket tag' };
  }
}

export async function removeTicketTagAction(ticketId: string, tagId: string) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: 'Forbidden' };
    }
    return { error: 'Unauthorized' };
  }

  try {
    await removeTagFromTicket(ticketId, tagId);
    revalidatePath('/dashboard/tickets');
    revalidatePath(`/dashboard/tickets/${ticketId}`);
    return { data: { ok: true } };
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return { error: 'Ticket not found' };
    }
    if (error instanceof TagNotFoundError) {
      return { error: 'Tag not found' };
    }
    if (error instanceof TicketTagNotFoundError) {
      return { error: 'Tag tidak ditemukan pada tiket ini.' };
    }
    return { error: 'Failed to remove ticket tag' };
  }
}
