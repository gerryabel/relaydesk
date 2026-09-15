import { NextResponse } from 'next/server';
import {
  getSavedView,
  updateSavedView,
  deleteSavedView,
  SavedViewNotFoundError,
  SavedViewForbiddenError,
  DuplicateSavedViewNameError,
} from '@/lib/saved-views/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { updateSavedViewSchema, type UpdateSavedViewInput } from '@/lib/saved-views/schema';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolved = await params;
    const view = await getSavedView(resolved.id);
    return NextResponse.json(view);
  } catch (error) {
    if (error instanceof SavedViewNotFoundError) {
      return NextResponse.json({ error: 'Saved view not found' }, { status: 404 });
    }
    if (error instanceof SavedViewForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load saved view' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolved = await params;
    const payload = (await request.json().catch(() => ({}))) as UpdateSavedViewInput;
    const parsed = updateSavedViewSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid saved view payload' },
        { status: 400 },
      );
    }

    const view = await updateSavedView(resolved.id, parsed.data);
    return NextResponse.json(view);
  } catch (error) {
    if (error instanceof SavedViewNotFoundError) {
      return NextResponse.json({ error: 'Saved view not found' }, { status: 404 });
    }
    if (error instanceof SavedViewForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof DuplicateSavedViewNameError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to update saved view' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolved = await params;
    const result = await deleteSavedView(resolved.id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SavedViewNotFoundError) {
      return NextResponse.json({ error: 'Saved view not found' }, { status: 404 });
    }
    if (error instanceof SavedViewForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to delete saved view' }, { status: 500 });
  }
}
