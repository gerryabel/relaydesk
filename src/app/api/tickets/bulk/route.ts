import { NextResponse } from 'next/server';
import { getCurrentMembership, ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { bulkUpdateTickets } from '@/lib/tickets/bulk';
import { BulkTicketIdsRequiredError, BulkTicketLimitExceededError, BulkDuplicateTicketIdsError, BulkActionNotSupportedError, BulkAssigneeNotInWorkspaceError, BulkInvalidTransitionError, BulkTagNotFoundError, BulkTagNotInWorkspaceError } from '@/lib/tickets/bulk';

export async function POST(request: Request) {
  try {
    await getCurrentMembership();
    const payload = await request.json();

    const result = await bulkUpdateTickets(payload);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof BulkTicketIdsRequiredError) {
      return NextResponse.json({ error: 'Bulk update failed. No tickets were changed.', reason: error.message }, { status: 400 });
    }
    if (error instanceof BulkTicketLimitExceededError) {
      return NextResponse.json({ error: 'Bulk update failed. No tickets were changed.', reason: error.message }, { status: 400 });
    }
    if (error instanceof BulkDuplicateTicketIdsError) {
      return NextResponse.json({ error: 'Bulk update failed. No tickets were changed.', reason: error.message }, { status: 400 });
    }
    if (error instanceof BulkActionNotSupportedError) {
      return NextResponse.json({ error: 'Bulk update failed. No tickets were changed.', reason: error.message }, { status: 400 });
    }
    if (error instanceof BulkAssigneeNotInWorkspaceError) {
      return NextResponse.json({ error: 'Bulk update failed. No tickets were changed.', reason: error.message }, { status: 400 });
    }
    if (error instanceof BulkInvalidTransitionError) {
      return NextResponse.json({ error: 'Bulk update failed. No tickets were changed.', reason: error.message }, { status: 409 });
    }
    if (error instanceof BulkTagNotFoundError) {
      return NextResponse.json({ error: 'Bulk update failed. No tickets were changed.', reason: error.message }, { status: 404 });
    }
    if (error instanceof BulkTagNotInWorkspaceError) {
      return NextResponse.json({ error: 'Bulk update failed. No tickets were changed.', reason: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Bulk update failed. No tickets were changed.' }, { status: 500 });
  }
}
