import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getTicketById, TicketNotFoundError } from '@/lib/tickets/server';
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
    const { title, description, priority, status } = payload ?? {};

    if (title !== undefined && typeof title !== 'string') {
      return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
    }
    if (description !== undefined && typeof description !== 'string') {
      return NextResponse.json({ error: 'Invalid description' }, { status: 400 });
    }
    if (priority !== undefined && !['low', 'medium', 'high', 'urgent'].includes(priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }
    if (status !== undefined && !['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
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

    const ticket = await getTicketById(resolved.id);
    const updatePayload: Record<string, unknown> = {};
    if (trimmedTitle !== undefined) updatePayload.title = trimmedTitle;
    if (description !== undefined) updatePayload.description = description.trim() || null;
    if (priority !== undefined) updatePayload.priority = priority;
    if (status !== undefined) updatePayload.status = status;

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: updatePayload,
      include: { createdBy: true },
    });

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
    return NextResponse.json({ error: 'Failed to update ticket' }, { status: 500 });
  }
}
