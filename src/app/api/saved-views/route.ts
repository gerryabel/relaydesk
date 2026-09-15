import { NextResponse } from 'next/server';
import { listSavedViews, createSavedView } from '@/lib/saved-views/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { createSavedViewSchema, type CreateSavedViewInput } from '@/lib/saved-views/schema';
import { DuplicateSavedViewNameError } from '@/lib/saved-views/server';

export async function GET() {
  try {
    const views = await listSavedViews();
    return NextResponse.json(views);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load saved views' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as CreateSavedViewInput;
    const parsed = createSavedViewSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid saved view payload' },
        { status: 400 },
      );
    }

    const view = await createSavedView(parsed.data);
    return NextResponse.json(view, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateSavedViewNameError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to create saved view' }, { status: 500 });
  }
}
