import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { getTicketTags, addTagToTicket } from '@/lib/tags/server';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const tags = await getTicketTags(resolved.id);

    return NextResponse.json(tags);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Failed to load ticket tags', error);
    return NextResponse.json({ error: 'Failed to load ticket tags' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const payload = await request.json();
    const { tagId } = payload ?? {};

    if (!tagId || typeof tagId !== 'string') {
      return NextResponse.json({ error: 'Tag ID wajib diisi' }, { status: 400 });
    }

    await addTagToTicket(resolved.id, tagId);

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof Error && error.message.includes('harus berada di workspace yang sama')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.name === 'TicketTagAlreadyExistsError') {
      return NextResponse.json({ error: 'Tiket sudah memiliki tag ini.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to add ticket tag' }, { status: 500 });
  }
}
