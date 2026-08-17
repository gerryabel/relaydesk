import { NextResponse } from 'next/server';
import { markNotificationAsRead, NotificationNotFoundError } from '@/lib/notifications/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolved = await params;
    const notification = await markNotificationAsRead(resolved.id);
    return NextResponse.json(notification);
  } catch (error) {
    if (error instanceof NotificationNotFoundError) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to mark notification as read' }, { status: 500 });
  }
}
