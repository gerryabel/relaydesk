import { NextResponse } from 'next/server';
import {
  getWorkspaceSettings,
  updateWorkspaceName,
} from '@/lib/workspace/settings';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { workspaceNameSchema } from '@/lib/workspace/settings';

export async function GET() {
  try {
    const settings = await getWorkspaceSettings();
    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load workspace settings' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const parsed = workspaceNameSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid workspace name' },
        { status: 400 },
      );
    }

    const settings = await updateWorkspaceName(parsed.data);
    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to update workspace name' }, { status: 500 });
  }
}
