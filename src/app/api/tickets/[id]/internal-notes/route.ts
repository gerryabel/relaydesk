import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership, ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { getInternalNotes, createInternalNote } from '@/lib/internal-notes/server';
import { createInternalNoteSchema } from '@/lib/internal-notes/schema';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const membership = await getCurrentMembership();
    const resolved = await params;

    const ticket = await prisma.ticket.findFirst({
      where: { id: resolved.id, workspaceId: membership.workspaceId },
      select: { id: true },
    });

    if (!ticket) {
      throw notFound();
    }

    const notes = await getInternalNotes(ticket.id);
    return NextResponse.json(notes);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load internal notes' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const membership = await getCurrentMembership();
    const resolved = await params;
    const payload = await request.json();
    const parsed = createInternalNoteSchema.safeParse(payload);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid internal note';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const ticket = await prisma.ticket.findFirst({
      where: { id: resolved.id, workspaceId: membership.workspaceId },
      select: { id: true },
    });

    if (!ticket) {
      throw notFound();
    }

    const note = await createInternalNote(ticket.id, parsed.data);

    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to create internal note' }, { status: 500 });
  }
}
