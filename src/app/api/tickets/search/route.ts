import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { getTickets } from '@/lib/tickets/server';
import { ticketSearchSchema, normalizeTicketSearch } from '@/lib/tickets/search';
import { ticketStatusSchema, ticketPrioritySchema } from '@/lib/tickets/schema';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get('q');
    const rawSort = searchParams.get('sort');
    const parsedQuery = ticketSearchSchema.safeParse({ q: rawQuery ?? undefined, sort: rawSort ?? undefined });

    if (!parsedQuery.success) {
      return NextResponse.json({ error: parsedQuery.error.issues[0]?.message ?? 'Invalid search' }, { status: 400 });
    }

    const normalized = normalizeTicketSearch(parsedQuery.data);

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

    const tickets = await getTickets({
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      search: normalized.q ? { q: normalized.q } : undefined,
      sort: normalized.sort,
    });

    return NextResponse.json(tickets);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load tickets' }, { status: 500 });
  }
}
