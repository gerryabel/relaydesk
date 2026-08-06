import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import { z } from 'zod';
import { createTicketSchema, updateTicketSchema, ticketStatusSchema, ticketPrioritySchema } from '@/lib/tickets/schema';
import type { CreateTicketInput, UpdateTicketInput } from '@/lib/tickets/schema';
import { mapTicketSortToOrderBy, normalizeTicketSort, type TicketSortInput } from '@/lib/tickets/sort';

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

type TicketGetOptions = {
  status?: StatusFilter;
  priority?: PriorityFilter;
  search?: SearchFilter | { q?: string };
  sort?: TicketSortInput | unknown;
  page?: number;
  limit?: number;
};

export async function getTickets(options: TicketGetOptions): Promise<TicketWithCreator[]> {
  const membership = await getCurrentMembership();
  const query =
    typeof options.search === 'string'
      ? options.search.trim()
      : options.search && typeof options.search === 'object'
        ? options.search.q?.trim()
        : undefined;
  const useOrSearch = options.search !== undefined && !(typeof options.search === 'string');

  const normalizedSort = normalizeTicketSort(options.sort);

  return prisma.ticket.findMany({
    where: {
      workspaceId: membership.workspaceId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.priority ? { priority: options.priority } : {}),
      ...(query
        ? useOrSearch
          ? {
              OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } },
              ],
            }
          : { title: { contains: query, mode: 'insensitive' } }
        : {}),
    },
    include: { createdBy: true },
    orderBy: normalizedSort ? mapTicketSortToOrderBy(normalizedSort) : { createdAt: 'desc' },
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
