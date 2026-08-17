import { getAllTicketsForMember } from './server';
import { getResponseSlaMonitoringStatus, getResolutionSlaMonitoringStatus } from '@/lib/tickets/sla';
import { normalizeTicketSort, type TicketSortInput } from './sort';
import { normalizeTicketPagination, type TicketPaginationResult } from './pagination';
import { getCurrentMembership } from '@/lib/workspace/server';
import type { TicketWithCreator } from './server';
import { ticketStatusSchema, ticketPrioritySchema } from './schema';
import { z } from 'zod';

type StatusFilter = z.infer<typeof ticketStatusSchema>;
type PriorityFilter = z.infer<typeof ticketPrioritySchema>;

export type QueueView = 'my-open' | 'waiting' | 'high-priority' | 'sla-risk';

export const QUEUE_VIEW_ORDER: QueueView[] = ['my-open', 'waiting', 'high-priority', 'sla-risk'];

export const QUEUE_VIEW_LABELS: Record<QueueView, string> = {
  'my-open': 'My Open',
  waiting: 'Waiting',
  'high-priority': 'High Priority',
  'sla-risk': 'SLA At Risk',
};

export const DEFAULT_QUEUE_VIEW: QueueView = 'my-open';

export const MY_OPEN_STATUSES = new Set(['open', 'in_progress']);
export const WAITING_STATUSES = new Set(['waiting_customer']);
export const HIGH_PRIORITY_PRIORITIES = new Set(['high', 'urgent']);
export const ACTIONABLE_STATUSES = new Set(['open', 'in_progress', 'waiting_customer']);

export function resolveQueueView(raw: unknown): QueueView {
  if (typeof raw === 'string' && QUEUE_VIEW_ORDER.includes(raw as QueueView)) {
    return raw as QueueView;
  }

  return DEFAULT_QUEUE_VIEW;
}

function ticketMatchesView(ticket: TicketWithCreator, view: QueueView, now: Date): boolean {
  switch (view) {
    case 'my-open':
      return MY_OPEN_STATUSES.has(ticket.status);
    case 'waiting':
      return WAITING_STATUSES.has(ticket.status);
    case 'high-priority':
      return HIGH_PRIORITY_PRIORITIES.has(ticket.priority);
    case 'sla-risk':
      return (
        getResponseSlaMonitoringStatus(ticket.responseSlaDeadline, ticket.firstResponseAt, ticket.createdAt, now) === 'at_risk' ||
        getResolutionSlaMonitoringStatus(ticket.resolutionSlaDeadline, ticket.resolvedAt, ticket.createdAt, now) === 'at_risk'
      );
    default:
      return false;
  }
}

export async function getMyQueueTickets(options: {
  view?: unknown;
  search?: string;
  sort?: unknown;
  page?: number;
  limit?: number;
  status?: StatusFilter;
  priority?: PriorityFilter;
  tagIds?: string[];
}): Promise<TicketPaginationResult<TicketWithCreator>> {
  const membership = await getCurrentMembership();
  const view = resolveQueueView(options.view);
  const normalizedSort = normalizeTicketSort(options.sort as TicketSortInput | undefined);
  const normalizedPagination = normalizeTicketPagination({ page: options.page, limit: options.limit });
  const search = typeof options.search === 'string' ? options.search.trim() : undefined;
  const tagIds = options.tagIds
    ?.map((tagId) => tagId.trim())
    .filter((tagId): tagId is string => Boolean(tagId));
  const now = new Date();

  const tickets = await getAllTicketsForMember({
    search,
    sort: normalizedSort,
    assignee: membership.userId,
    tagIds,
    status: options.status,
    priority: options.priority,
  });

  const filtered = tickets.filter((ticket) => {
    if (!ACTIONABLE_STATUSES.has(ticket.status)) {
      return false;
    }
    if (options.status && ticket.status !== options.status) {
      return false;
    }
    if (options.priority && ticket.priority !== options.priority) {
      return false;
    }
    return ticketMatchesView(ticket, view, now);
  });

  const page = Math.min(normalizedPagination.page, Math.max(1, Math.ceil(filtered.length / normalizedPagination.limit) || 1));
  const start = (page - 1) * normalizedPagination.limit;
  const data = filtered.slice(start, start + normalizedPagination.limit);

  return {
    data,
    page,
    limit: normalizedPagination.limit,
    total: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / normalizedPagination.limit)),
    hasPreviousPage: page > 1,
    hasNextPage: start + normalizedPagination.limit < filtered.length,
  };
}

export async function getMyQueueCounts(options: {
  view?: unknown;
  search?: string;
  sort?: unknown;
  status?: StatusFilter;
  priority?: PriorityFilter;
  tagIds?: string[];
}): Promise<Record<QueueView, number>> {
  const membership = await getCurrentMembership();
  const search = typeof options.search === 'string' ? options.search.trim() : undefined;
  const tagIds = options.tagIds
    ?.map((tagId) => tagId.trim())
    .filter((tagId): tagId is string => Boolean(tagId));
  const now = new Date();

  const tickets = await getAllTicketsForMember({
    search,
    sort: normalizeTicketSort(options.sort as TicketSortInput | undefined),
    assignee: membership.userId,
    tagIds,
    status: options.status,
    priority: options.priority,
  });

  const counts = {
    'my-open': 0,
    waiting: 0,
    'high-priority': 0,
    'sla-risk': 0,
  } as Record<QueueView, number>;

  for (const ticket of tickets) {
    if (!ACTIONABLE_STATUSES.has(ticket.status)) {
      continue;
    }
    if (options.status && ticket.status !== options.status) {
      continue;
    }
    if (options.priority && ticket.priority !== options.priority) {
      continue;
    }
    for (const view of QUEUE_VIEW_ORDER) {
      if (ticketMatchesView(ticket, view, now)) {
        counts[view] += 1;
      }
    }
  }

  return counts;
}
