import { NextResponse } from 'next/server';
import {
  getMemberById,
  updateMemberRole,
  MemberNotFoundError,
  MemberNotInWorkspaceError,
  CannotDemoteLastOwnerError,
  InvalidRoleChangeError,
} from '@/lib/members/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { updateMemberRoleSchema } from '@/lib/members/schema';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const member = await getMemberById(resolved.id);
    return NextResponse.json(member);
  } catch (error) {
    if (error instanceof MemberNotFoundError || error instanceof MemberNotInWorkspaceError) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load member' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const payload = await request.json().catch(() => ({}));
    const parsed = updateMemberRoleSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid role payload' },
        { status: 400 },
      );
    }

    const member = await updateMemberRole(resolved.id, parsed.data);
    return NextResponse.json(member);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof MemberNotFoundError) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    if (error instanceof MemberNotInWorkspaceError) {
      return NextResponse.json({ error: 'Member is not in this workspace' }, { status: 404 });
    }
    if (error instanceof CannotDemoteLastOwnerError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof InvalidRoleChangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to update member role' }, { status: 500 });
  }
}
