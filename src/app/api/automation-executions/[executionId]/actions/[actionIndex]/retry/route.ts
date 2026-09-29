import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { ExecutionNotFoundError } from '@/lib/automation/execution-service';
import {
  ActionNotFoundError,
  ExecutionNotRetryableError,
  ExecutionRetryConflictError,
  retryFailedFinalAction,
} from '@/lib/automation/executions';
import { retryActionParamsSchema } from '@/lib/automation/executions-schema';

type RouteContext = { params: Promise<{ executionId: string; actionIndex: string }> };

/**
 * Owner-only manual retry of the final failed action of an execution.
 *
 * The retry runs inside the domain service, where it is atomic (action reset +
 * execution reopen + exactly one AUTOMATION_ACTION_EXECUTION outbox event in
 * one transaction) and race-safe (conditional updates → 409 on conflict).
 * The event is executed by the existing outbox → BullMQ → worker pipeline;
 * nothing here calls the worker directly.
 *
 * No client-supplied state influences the operation: workspace identity comes
 * from the authenticated membership, and execution/action identity comes from
 * the URL path.
 */
export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const { executionId, actionIndex } = await params;

    const parsed = retryActionParamsSchema.safeParse({ executionId, actionIndex });

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid retry parameters' },
        { status: 400 },
      );
    }

    const result = await retryFailedFinalAction(parsed.data.executionId, parsed.data.actionIndex);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof ExecutionNotFoundError) {
      return NextResponse.json({ error: 'Automation execution not found', code: error.name }, { status: 404 });
    }
    if (error instanceof ActionNotFoundError) {
      return NextResponse.json({ error: error.message, code: error.name }, { status: 404 });
    }
    if (error instanceof ExecutionNotRetryableError || error instanceof ExecutionRetryConflictError) {
      return NextResponse.json({ error: error.message, code: error.name }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Failed to retry automation action', code: 'RetryFailed' },
      { status: 500 },
    );
  }
}
