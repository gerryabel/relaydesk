import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { listRules, createRule } from '@/lib/automation/rules';
import {
  RuleLimitReachedError,
  RuleNameConflictError,
  RuleValidationError,
  RuleReferencedResourceError,
} from '@/lib/automation/rules';

export async function GET() {
  try {
    const rules = await listRules();
    return NextResponse.json(rules);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load automation rules' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const rule = await createRule(payload);
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    return NextResponse.json({ error: 'Failed to create automation rule' }, { status: 500 });
  }
}
