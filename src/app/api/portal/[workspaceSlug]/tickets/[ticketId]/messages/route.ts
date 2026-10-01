import { NextResponse, type NextRequest } from 'next/server';
import { createCustomerReply } from '@/lib/customer-portal/server';
import { toCustomerPortalError } from '@/lib/customer-portal/http';

/**
 * POST /api/portal/[workspaceSlug]/tickets/[ticketId]/messages
 *
 * Posts a customer-authored reply on a ticket the customer owns
 * (Phase 9 Task 3).
 *
 * | Status | Meaning |
 * | --- | --- |
 * | 201 | reply stored, returns the customer-safe message DTO |
 * | 400 | invalid body, or the ticket is closed |
 * | 401 | no customer session |
 * | 403 | session belongs to another workspace |
 * | 404 | unknown ticket, or one owned by someone else |
 * | 500 | anything else, with a fixed message |
 *
 * The request body is `{ body }` and nothing else — `strictObject` rejects
 * `status`, `authorType`, `customerId` or `ticketId` outright rather than
 * ignoring them. Identity comes from the session, so this endpoint cannot be
 * used to post as an agent or as another customer, and it cannot move a
 * ticket's status.
 *
 * The response is the same `CustomerMessageView` the detail endpoint
 * serializes, so no raw message id is exposed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string; ticketId: string }> },
) {
  try {
    const { workspaceSlug, ticketId } = await params;

    const rawInput = await request.json().catch(() => ({}));

    const { message } = await createCustomerReply({ workspaceSlug, ticketId, rawInput });

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    const { status, body } = toCustomerPortalError(error, 'Failed to send reply');

    return NextResponse.json(body, { status });
  }
}
