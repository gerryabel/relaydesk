import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { getAutomationExecutionById } from '@/lib/automation/executions';
import { ExecutionNotFoundError } from '@/lib/automation/execution-service';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const execution = await getAutomationExecutionById(id);
    return NextResponse.json(execution);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Identical response for "missing" and "owned by another workspace" so
    // cross-workspace existence is never disclosed.
    if (error instanceof ExecutionNotFoundError) {
      return NextResponse.json({ error: 'Automation execution not found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Failed to load automation execution' },
      { status: 500 },
    );
  }
}
