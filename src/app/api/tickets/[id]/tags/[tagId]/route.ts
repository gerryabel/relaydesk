import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { removeTagFromTicket, TagNotFoundError, TicketNotFoundError, TicketTagNotFoundError } from '@/lib/tags/server';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; tagId: string }> }) {
  try {
    const resolved = await params;
    await removeTagFromTicket(resolved.id, resolved.tagId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof TicketNotFoundError) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }
    if (error instanceof TagNotFoundError) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }
    if (error instanceof TicketTagNotFoundError) {
      return NextResponse.json({ error: 'Tag tidak ditemukan pada tiket ini.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to remove ticket tag' }, { status: 500 });
  }
}
