import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { getTagById, updateTag, deleteTag, TagNotFoundError, DuplicateTagError } from '@/lib/tags/server';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const tag = await getTagById(resolved.id);

    return NextResponse.json(tag);
  } catch (error) {
    if (error instanceof TagNotFoundError) {
      throw notFound();
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load tag' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const payload = await request.json();
    const { name } = payload ?? {};

    if (name !== undefined && typeof name !== 'string') {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }

    const tag = await updateTag(resolved.id, { name });

    return NextResponse.json(tag);
  } catch (error) {
    if (error instanceof TagNotFoundError) {
      throw notFound();
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof DuplicateTagError) {
      return NextResponse.json({ error: 'Tag dengan nama yang sama sudah ada di workspace ini.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to update tag' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    await deleteTag(resolved.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TagNotFoundError) {
      throw notFound();
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
  }
}
