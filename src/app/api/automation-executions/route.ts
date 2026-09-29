import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { listAutomationExecutions } from '@/lib/automation/executions';
import { readExecutionListQuery, toExecutionFilters } from '@/lib/automation/executions-schema';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = readExecutionListQuery(searchParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid query' },
        { status: 400 },
      );
    }

    const result = await listAutomationExecutions(toExecutionFilters(parsed.data));

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load automation executions' }, { status: 500 });
  }
}
