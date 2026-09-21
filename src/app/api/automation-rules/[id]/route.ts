import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { getRuleById, updateRule, deleteRule, setRuleEnabled } from '@/lib/automation/rules';
import {
  RuleNotFoundError,
  RuleLimitReachedError,
  RuleNameConflictError,
  RuleValidationError,
  RuleReferencedResourceError,
} from '@/lib/automation/rules';

function handleError(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (error instanceof RuleNotFoundError) {
    return NextResponse.json({ error: 'Automation rule not found' }, { status: 404 });
  }
  if (error instanceof RuleValidationError) {
    return NextResponse.json({ error: error.message, code: error.name }, { status: 400 });
  }
  if (error instanceof RuleReferencedResourceError) {
    return NextResponse.json({ error: error.message, code: error.name }, { status: 400 });
  }
  if (error instanceof RuleNameConflictError) {
    return NextResponse.json({ error: error.message, code: error.name }, { status: 409 });
  }
  if (error instanceof RuleLimitReachedError) {
    return NextResponse.json({ error: error.message, code: error.name }, { status: 409 });
  }
  return NextResponse.json({ error: 'Failed to process automation rule request' }, { status: 500 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rule = await getRuleById(id);
    return NextResponse.json(rule);
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = await request.json();

    // Owner-only mutation: setRuleEnabled is a separate toggle endpoint,
    // but we support a top-level PATCH for general updates.
    if (payload && typeof payload.enabled === 'boolean' && Object.keys(payload).length === 1) {
      const rule = await setRuleEnabled(id, payload.enabled);
      return NextResponse.json(rule);
    }

    const rule = await updateRule(id, payload);
    return NextResponse.json(rule);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteRule(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
