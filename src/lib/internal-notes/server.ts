import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import { createInternalNoteSchema, type CreateInternalNoteInput } from '@/lib/internal-notes/schema';

export class TicketNotFoundError extends Error {
  constructor(message = 'Tiket tidak ditemukan.') {
    super(message);
    this.name = 'TicketNotFoundError';
  }
}

export type InternalNoteWithAuthor = {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string;
    email: string;
  };
};

type TransactionClient = Parameters<Parameters<typeof prisma['$transaction']>[0]>[0];

export async function getInternalNotes(ticketId: string): Promise<InternalNoteWithAuthor[]> {
  const membership = await getCurrentMembership();

  const ticket = await prisma.ticket.findFirst({
    where: {
      id: ticketId,
      workspaceId: membership.workspaceId,
    },
    select: { id: true },
  });

  if (!ticket) {
    throw new TicketNotFoundError();
  }

  return prisma.internalNote.findMany({
    where: { ticketId: ticket.id },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  }) as Promise<InternalNoteWithAuthor[]>;
}

export async function createInternalNote(
  ticketId: string,
  input: CreateInternalNoteInput,
  options: {
    tx?: TransactionClient;
    actorId?: string;
  } = {},
): Promise<InternalNoteWithAuthor> {
  const membership = await getCurrentMembership();
  const parsed = createInternalNoteSchema.parse(input);
  const authorId = options.actorId ?? membership.userId;

  const noteWithActivity = (options.tx ?? prisma).$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: {
        id: ticketId,
        workspaceId: membership.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!ticket) {
      throw new TicketNotFoundError();
    }

    const note = await tx.internalNote.create({
      data: {
        ticketId: ticket.id,
        authorId,
        body: parsed.body,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    await tx.ticketActivity.create({
      data: {
        ticketId: ticket.id,
        actorId: authorId,
        type: 'INTERNAL_NOTE_CREATED',
        metadata: { internalNoteId: note.id } as never,
      },
    });

    return note;
  });

  return noteWithActivity as Promise<InternalNoteWithAuthor>;
}
