import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership, ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { createMessageSchema } from '@/lib/messages/schema';

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

    const messages = await prisma.message.findMany({
      where: { ticketId: ticket.id },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            emailVerified: true,
            name: true,
            image: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        attachments: {
          select: {
            id: true,
            originalFilename: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(messages);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const membership = await getCurrentMembership();
    const resolved = await params;
    const payload = await request.json();
    const parsed = createMessageSchema.safeParse(payload);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid message';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const ticket = await prisma.ticket.findFirst({
      where: { id: resolved.id, workspaceId: membership.workspaceId },
      select: { id: true },
    });

    if (!ticket) {
      throw notFound();
    }

    const message = await prisma.message.create({
      data: {
        ticketId: ticket.id,
        body: parsed.data.body,
        createdById: membership.userId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            emailVerified: true,
            name: true,
            image: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        attachments: {
          select: {
            id: true,
            originalFilename: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
    });

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to create message' }, { status: 500 });
  }
}
