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
  attachments: Array<{
    id: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  }>;
};

export async function createMessage(ticketId: string, input: CreateMessageInput): Promise<MessageWithCreator> {
  const membership = await getCurrentMembership();
  const parsed = createMessageSchema.parse(input);

  const ticket = await prisma.ticket.findFirst({
    where: {
      id: ticketId,
      workspaceId: membership.workspaceId,
    },
    select: {
      id: true,
      createdById: true,
      firstResponseAt: true,
    },
  });

  if (!ticket) {
    throw new TicketNotFoundError();
  }

  const message = await prisma.message.create({
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
      attachments: {
        select: {
          id: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      },
    },
  });

  const isQualifyingAgentResponse = !ticket.firstResponseAt && membership.userId !== ticket.createdById;

  if (isQualifyingAgentResponse) {
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { firstResponseAt: new Date() },
    });
  }

  return message as MessageWithCreator;
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
      attachments: {
        select: {
          id: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  }) as Promise<MessageWithCreator[]>;
}
