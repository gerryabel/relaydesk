import { NextResponse } from 'next/server';
import {
  getWorkspaceSlaPolicies,
  updateWorkspaceSlaPolicies,
  slaPolicyInputSchema,
} from '@/lib/workspace/sla-policy';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';

export async function GET() {
  try {
    const policies = await getWorkspaceSlaPolicies();
    return NextResponse.json({ policies });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to load SLA policies' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json().catch(() => null);

    const parsed = slaPolicyInputSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid SLA policy payload' },
        { status: 400 },
      );
    }

    const policies = await updateWorkspaceSlaPolicies(parsed.data);
    return NextResponse.json({ policies });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to update SLA policies' }, { status: 500 });
  }
}
