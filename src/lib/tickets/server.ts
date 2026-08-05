import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import { z } from 'zod';
import { createTicketSchema, updateTicketSchema, ticketStatusSchema, ticketPrioritySchema } from '@/lib/tickets/schema';
import type { CreateTicketInput, UpdateTicketInput } from '@/lib/tickets/schema';

export class TicketNotFoundError extends Error {
  constructor(message = 'Tiket tidak ditemukan.') {
    super(message);
    this.name = 'TicketNotFoundError';
  }
}

export type TicketWithCreator = {
  id: string;
  workspaceId: string;
  createdById: string | null;
  title: string;
  description: string | null;
  status: z.infer<typeof ticketStatusSchema>;
  priority: z.infer<typeof ticketPrioritySchema>;
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

export async function createTicket(input: CreateTicketInput): Promise<TicketWithCreator> {
  const parsed = createTicketSchema.parse(input);
  const membership = await getCurrentMembership();

  return prisma.ticket.create({
    data: {
      workspaceId: membership.workspaceId,
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      createdById: membership.userId,
    },
    include: {
      createdBy: true,
    },
  }) as Promise<TicketWithCreator>;
}

type StatusFilter = z.infer<typeof ticketStatusSchema> | undefined;
type PriorityFilter = z.infer<typeof ticketPrioritySchema> | undefined;
type SearchFilter = string | undefined;

export async function getTickets(
  status?: StatusFilter,
  priority?: PriorityFilter,
  search?: SearchFilter
): Promise<TicketWithCreator[]> {
  const membership = await getCurrentMembership();
  const trimmedSearch = search?.trim();

  return prisma.ticket.findMany({
    where: {
      workspaceId: membership.workspaceId,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(trimmedSearch ? { title: { contains: trimmedSearch, mode: 'insensitive' } } : {}),
    },
    include: {
      createdBy: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  }) as Promise<TicketWithCreator[]>;
}

export async function getTicketById(id: string): Promise<TicketWithCreator> {
  const membership = await getCurrentMembership();

  const ticket = await prisma.ticket.findFirst({
    where: {
      id,
      workspaceId: membership.workspaceId,
    },
    include: {
      createdBy: true,
    },
  });

  if (!ticket) {
    throw new TicketNotFoundError();
  }

  return ticket as TicketWithCreator;
}

export async function updateTicket(id: string, input: UpdateTicketInput): Promise<TicketWithCreator> {
  const membership = await getCurrentMembership();
  const parsed = updateTicketSchema.parse(input);

  const existing = await prisma.ticket.findFirst({
    where: {
      id,
      workspaceId: membership.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    throw new TicketNotFoundError();
  }

  return prisma.ticket.update({
    where: {
      id,
    },
    data: parsed,
    include: {
      createdBy: true,
    },
  }) as Promise<TicketWithCreator>;
}

export async function closeTicket(id: string): Promise<TicketWithCreator> {
  const membership = await getCurrentMembership();

  const existing = await prisma.ticket.findFirst({
    where: {
      id,
      workspaceId: membership.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    throw new TicketNotFoundError();
  }

  return prisma.ticket.update({
    where: {
      id,
    },
    data: {
      status: 'closed',
    },
    include: {
      createdBy: true,
    },
  }) as Promise<TicketWithCreator>;
}
