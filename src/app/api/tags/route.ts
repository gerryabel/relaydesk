import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { getTags, createTag, DuplicateTagError } from '@/lib/tags/server';

export async function GET() {
  try {
    const tags = await getTags();

    return NextResponse.json(tags);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load tags' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { name } = payload ?? {};

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Nama tag wajib diisi' }, { status: 400 });
    }

    const tag = await createTag({ name });

    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof DuplicateTagError) {
      return NextResponse.json({ error: 'Tag dengan nama yang sama sudah ada di workspace ini.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
  }
}
