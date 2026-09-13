import { NextResponse } from 'next/server';
import { getMembers } from '@/lib/members/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';

export async function GET() {
  try {
    const members = await getMembers();
    return NextResponse.json(members);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }
}
