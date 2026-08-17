import { NextResponse } from 'next/server';
import { getNotifications } from '@/lib/notifications/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get('page') ?? '1');
    const limit = Number(searchParams.get('limit') ?? '20');
    const unreadOnly = searchParams.get('unreadOnly') === 'true';

    const notifications = await getNotifications({ page, limit, unreadOnly });
    return NextResponse.json(notifications);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 });
  }
}
