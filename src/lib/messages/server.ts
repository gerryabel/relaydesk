import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import { createMessageSchema } from '@/lib/messages/schema';
import type { CreateMessageInput } from '@/lib/messages/schema';

export class MessageNotFoundError extends Error {
  constructor(message = 'Pesan tidak ditemukan.') {
    super(message);
    this.name = 'MessageNotFoundError';
  }
}

export class TicketNotFoundError extends Error {
  constructor(message = 'Tiket tidak ditemukan.') {
    super(message);
    this.name = 'TicketNotFoundError';
  }
}

export type MessageWithCreator = {
  id: string;
  ticketId: string;
  createdById: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    image: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

export async function createMessage(ticketId: string, input: CreateMessageInput): Promise<MessageWithCreator> {
  const membership = await getCurrentMembership();
  const parsed = createMessageSchema.parse(input);

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

  return prisma.message.create({
    data: {
      ticketId,
      body: parsed.body,
      createdById: membership.userId,
    },
    include: {
      createdBy: {
        select: {
          id: true,
          email: true,
          emailVerified: true,
          name: true,
          image: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  }) as Promise<MessageWithCreator>;
}

export async function getMessages(ticketId: string): Promise<MessageWithCreator[]> {
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

  return prisma.message.findMany({
    where: { ticketId },
    include: {
      createdBy: {
        select: {
          id: true,
          email: true,
          emailVerified: true,
          name: true,
          image: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  }) as Promise<MessageWithCreator[]>;
}
