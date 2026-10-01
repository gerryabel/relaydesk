import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import { createMessageSchema } from '@/lib/messages/schema';
import type { CreateMessageInput } from '@/lib/messages/schema';
import { assertMessageAuthor, type MessageAuthorType } from '@/lib/messages/authorship';
import { queueCustomerReplyEmail } from '@/lib/customer-notifications/events';

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

/**
 * A message with just enough related rows for the internal conversation view:
 * the workspace user who wrote it, the linked customer (for customer-authored
 * rows) and any attachments.
 *
 * `authorType` is included deliberately. The internal UI renders every message,
 * including ones a customer wrote, and before Task 3 it displayed those as
 * "Unknown" because the row had no customer foreign key to join on.
 */
export type MessageWithCreator = {
  id: string;
  ticketId: string;
  createdById: string | null;
  customerId: string | null;
  authorType: MessageAuthorType;
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
  customer: {
    id: string;
    name: string;
    email: string | null;
  } | null;
  attachments: Array<{
    id: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  }>;
};

const messageInclude = {
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
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
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
} as const;

/**
 * The single writer for agent-authored messages.
 *
 * API routes and server actions must not insert `Message` rows themselves:
 * this is where the authorship invariant, the `firstResponseAt` side effect
 * and the customer notification event are applied together, so a reply cannot
 * exist in the conversation while its email event rolled back.
 */
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
      customerId: true,
    },
  });

  if (!ticket) {
    throw new TicketNotFoundError();
  }

  // Guards the shape the CHECK constraints in the Task 3 migration enforce,
  // so a future refactor fails in a unit test with a readable message rather
  // than as an opaque Prisma error at runtime.
  assertMessageAuthor({
    authorType: 'agent',
    createdById: membership.userId,
    customerId: null,
  });

  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        ticketId: ticket.id,
        body: parsed.body,
        createdById: membership.userId,
        customerId: null,
        authorType: 'agent',
      },
      include: messageInclude,
    });

    const isQualifyingAgentResponse = !ticket.firstResponseAt && membership.userId !== ticket.createdById;

    if (isQualifyingAgentResponse) {
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { firstResponseAt: new Date() },
      });
    }

    await queueCustomerReplyEmail(tx, {
      workspaceId: membership.workspaceId,
      ticketId: ticket.id,
      customerId: ticket.customerId,
      messageId: message.id,
    });

    return message as MessageWithCreator;
  });
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
    include: messageInclude,
    orderBy: { createdAt: 'asc' },
  }) as Promise<MessageWithCreator[]>;
}
