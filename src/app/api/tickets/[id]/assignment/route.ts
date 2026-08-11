import { NextResponse } from 'next/server';
import { assignTicket, unassignTicket, TicketNotFoundError, AssigneeNotInWorkspaceError } from '@/lib/tickets/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { assignTicketSchema } from '@/lib/tickets/schema';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const payload = await request.json().catch(() => ({}));
    const parsed = assignTicketSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid ticket assignment' }, { status: 400 });
    }

    const ticket = await assignTicket(resolved.id, parsed.data);
    return NextResponse.json(ticket);
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof AssigneeNotInWorkspaceError) {
      return NextResponse.json({ error: 'Assignee is not in this workspace' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to assign ticket' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const ticket = await unassignTicket(resolved.id);
    return NextResponse.json(ticket);
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof AssigneeNotInWorkspaceError) {
      return NextResponse.json({ error: 'Assignee is not in this workspace' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to unassign ticket' }, { status: 500 });
  }
}
