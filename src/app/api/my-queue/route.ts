import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { getMyQueueTickets, getMyQueueCounts, resolveQueueView, QUEUE_VIEW_LABELS, type QueueView } from '@/lib/tickets/queue';
import { ticketStatusSchema, ticketPrioritySchema } from '@/lib/tickets/schema';
import { normalizeTicketPagination } from '@/lib/tickets/pagination';

const ticketTagFilterSchema = z.object({
  tagId: z.string().trim().min(1).max(64).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const view = resolveQueueView((searchParams.get('view') as QueueView | null) ?? undefined);
    const rawSort = searchParams.get('sort') ?? '';
    const rawPage = searchParams.get('page');
    const rawLimit = searchParams.get('limit');
    const rawSearch = searchParams.get('search') ?? searchParams.get('q') ?? '';

    let status: z.infer<typeof ticketStatusSchema> | undefined;
    if (searchParams.has('status')) {
      const result = ticketStatusSchema.safeParse(searchParams.get('status'));
      if (!result.success) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      status = result.data;
    }

    let priority: z.infer<typeof ticketPrioritySchema> | undefined;
    if (searchParams.has('priority')) {
      const result = ticketPrioritySchema.safeParse(searchParams.get('priority'));
      if (!result.success) {
        return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
      }
      priority = result.data;
    }

    const tagResult = ticketTagFilterSchema.safeParse({ tagId: searchParams.get('tagId') });
    if (searchParams.has('tagId') && !tagResult.success) {
      return NextResponse.json({ error: 'Invalid tagId' }, { status: 400 });
    }

    const pagination = normalizeTicketPagination({
      page: rawPage ? Number(rawPage) : undefined,
      limit: rawLimit ? Number(rawLimit) : undefined,
    });

    const [tickets, counts] = await Promise.all([
      getMyQueueTickets({
        view,
        search: rawSearch || undefined,
        sort: rawSort || undefined,
        page: pagination.page,
        limit: pagination.limit,
        status,
        priority,
        tagIds: tagResult.success && tagResult.data.tagId ? [tagResult.data.tagId] : undefined,
      }),
      getMyQueueCounts({
        view,
        search: rawSearch || undefined,
        sort: rawSort || undefined,
        status,
        priority,
        tagIds: tagResult.success && tagResult.data.tagId ? [tagResult.data.tagId] : undefined,
      }),
    ]);

    const response = {
      view,
      label: QUEUE_VIEW_LABELS[view],
      counts: Object.fromEntries(
        Object.entries(counts).map(([queueView, count]) => [queueView, count]),
      ) as Record<QueueView, number>,
      tickets: tickets.data.map((ticket) => ({
        ...ticket,
        createdBy: ticket.createdBy,
        assignedTo: ticket.assignedTo,
        customer: ticket.customer,
      })),
      pagination: {
        page: tickets.page,
        limit: tickets.limit,
        total: tickets.total,
        totalPages: tickets.totalPages,
        hasPreviousPage: tickets.hasPreviousPage,
        hasNextPage: tickets.hasNextPage,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load queue' }, { status: 500 });
  }
}
