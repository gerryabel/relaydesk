import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { getTicketById, TicketNotFoundError, updateTicket, CustomerNotInWorkspaceError } from '@/lib/tickets/server';
import { InvalidTicketTransitionError } from '@/lib/tickets/workflow';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const ticket = await getTicketById(resolved.id);
    return NextResponse.json(ticket);
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      throw notFound();
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load ticket' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const payload = await request.json();
    const { title, description, priority, status, customerId } = payload ?? {};

    if (title !== undefined && typeof title !== 'string') {
      return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
    }
    if (description !== undefined && typeof description !== 'string') {
      return NextResponse.json({ error: 'Invalid description' }, { status: 400 });
    }
    if (priority !== undefined && !['low', 'medium', 'high', 'urgent'].includes(priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }
    if (status !== undefined && !['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    if (customerId !== undefined && customerId !== null && typeof customerId !== 'string') {
      return NextResponse.json({ error: 'Invalid customer' }, { status: 400 });
    }

    const trimmedTitle = title?.trim();
    if (trimmedTitle !== undefined) {
      if (!trimmedTitle) {
        return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
      }
      if (trimmedTitle.length > 140) {
        return NextResponse.json({ error: 'Title is too long' }, { status: 400 });
      }
    }
    if (description !== undefined && description.length > 5000) {
      return NextResponse.json({ error: 'Description is too long' }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {};
    if (trimmedTitle !== undefined) updatePayload.title = trimmedTitle;
    if (description !== undefined) updatePayload.description = description.trim() || null;
    if (priority !== undefined) updatePayload.priority = priority;
    if (status !== undefined) updatePayload.status = status;
    if (customerId !== undefined) updatePayload.customerId = customerId;

    const updated = await updateTicket(resolved.id, updatePayload as import('@/lib/tickets/schema').UpdateTicketInput);

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      throw notFound();
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof InvalidTicketTransitionError) {
      return NextResponse.json({ error: error.message ?? 'Invalid ticket transition' }, { status: 409 });
    }
    if (error instanceof CustomerNotInWorkspaceError) {
      return NextResponse.json({ error: 'Customer is not in this workspace' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to update ticket' }, { status: 500 });
  }
}
