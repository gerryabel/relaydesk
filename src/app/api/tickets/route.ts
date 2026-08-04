import { NextResponse } from 'next/server';
import { getCurrentMembership, ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  try {
    const membership = await getCurrentMembership();
    const tickets = await prisma.ticket.findMany({
      where: { workspaceId: membership.workspaceId },
      include: { createdBy: true },
      orderBy: { createdAt: 'desc' },
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

export async function POST(request: Request) {
  try {
    const membership = await getCurrentMembership();
    const payload = await request.json();
    const { title, description, priority } = payload ?? {};

    if (!title || typeof title !== 'string') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    if (description !== undefined && typeof description !== 'string') {
      return NextResponse.json({ error: 'Invalid description' }, { status: 400 });
    }
    if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }
    if (trimmedTitle.length > 140) {
      return NextResponse.json({ error: 'Title is too long' }, { status: 400 });
    }
    if (description !== undefined && description.length > 5000) {
      return NextResponse.json({ error: 'Description is too long' }, { status: 400 });
    }

    const ticket = await prisma.ticket.create({
      data: {
        workspaceId: membership.workspaceId,
        title: trimmedTitle,
        description: description ? description.trim() || null : null,
        priority,
        createdById: membership.userId,
      },
      include: { createdBy: true },
    });

    return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
  }
}
