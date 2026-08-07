import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import { z } from 'zod';
import { createTicketSchema, updateTicketSchema, ticketStatusSchema, ticketPrioritySchema, assignTicketSchema } from '@/lib/tickets/schema';
import type { CreateTicketInput, UpdateTicketInput, AssignTicketInput } from '@/lib/tickets/schema';
import { mapTicketSortToOrderBy, normalizeTicketSort, type TicketSortInput } from '@/lib/tickets/sort';
import { normalizeTicketPagination, type TicketPaginationResult } from '@/lib/tickets/pagination';
import type { Prisma } from '@/generated/prisma';

export class TicketNotFoundError extends Error {
  constructor(message = 'Tiket tidak ditemukan.') {
    super(message);
    this.name = 'TicketNotFoundError';
  }
}

export class AssigneeNotInWorkspaceError extends Error {
  constructor(message = 'Assignee bukan member workspace ini.') {
    super(message);
    this.name = 'AssigneeNotInWorkspaceError';
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
  assignedTo?: {
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

function buildTicketWhere(options: {
  membership: { workspaceId: string };
  status?: StatusFilter;
  priority?: PriorityFilter;
  query?: string;
  useOrSearch?: boolean;
}): WhereInput {
  const { membership, status, priority, query, useOrSearch } = options;

  return {
    workspaceId: membership.workspaceId,
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(query
      ? useOrSearch
        ? {
            OR: [
              { title: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
              { description: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
            ],
          }
        : { title: { contains: query, mode: 'insensitive' as Prisma.QueryMode } }
      : {}),
  };
}

type WhereInput = Pick<Prisma.TicketWhereInput, 'AND' | 'OR' | 'NOT'> & {
  workspaceId: Prisma.TicketWhereInput['workspaceId'];
  status?: Prisma.TicketWhereInput['status'];
  priority?: Prisma.TicketWhereInput['priority'];
};

function asTicketWhere(where: WhereInput): Prisma.TicketWhereInput {
  return where as Prisma.TicketWhereInput;
}

export async function getTickets(options: TicketGetOptions = {}): Promise<TicketPaginationResult<TicketWithCreator>> {
  const membership = await getCurrentMembership();
  const query =
    typeof options.search === 'string'
      ? options.search.trim()
      : options.search && typeof options.search === 'object'
        ? options.search.q?.trim()
        : undefined;
  const useOrSearch = options.search !== undefined && !(typeof options.search === 'string');

  const normalizedSort = normalizeTicketSort(options.sort);
  const normalizedPagination = normalizeTicketPagination({ page: options.page, limit: options.limit });
  const { page, limit } = normalizedPagination;

  const where = buildTicketWhere({
    membership,
    status: options.status,
    priority: options.priority,
    query,
    useOrSearch,
  });

  const total = await prisma.ticket.count({ where: asTicketWhere(where) });
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const normalizedPage = Math.min(page, totalPages);
  const skip = (normalizedPage - 1) * limit;

  const tickets = await prisma.ticket
    .findMany({
      where: asTicketWhere(where),
      include: { createdBy: true },
      orderBy: normalizedSort ? mapTicketSortToOrderBy(normalizedSort) : { createdAt: 'desc' },
      skip,
      take: limit,
    })
    .then((items) => items as TicketWithCreator[]);

  return {
    data: tickets,
    page: normalizedPage,
    limit,
    total,
    totalPages,
    hasPreviousPage: normalizedPage > 1,
    hasNextPage: normalizedPage < totalPages,
  };
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
      assignedTo: true,
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

export async function assignTicket(id: string, input: AssignTicketInput): Promise<TicketWithCreator> {
  const membership = await getCurrentMembership();
  const parsed = assignTicketSchema.parse(input);

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

  const assigneeMembership = await prisma.membership.findFirst({
    where: {
      userId: parsed.assigneeId,
      workspaceId: membership.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!assigneeMembership) {
    throw new AssigneeNotInWorkspaceError();
  }

  return prisma.ticket.update({
    where: {
      id,
    },
    data: {
      assignedToId: parsed.assigneeId,
    },
    include: {
      createdBy: true,
      assignedTo: true,
    },
  }) as Promise<TicketWithCreator>;
}

export async function unassignTicket(id: string): Promise<TicketWithCreator> {
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
      assignedToId: null,
    },
    include: {
      createdBy: true,
      assignedTo: true,
    },
  }) as Promise<TicketWithCreator>;
}
