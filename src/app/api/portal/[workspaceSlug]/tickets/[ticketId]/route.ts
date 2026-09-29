import { NextResponse, type NextRequest } from 'next/server';
import { getCustomerTicket } from '@/lib/customer-portal/server';
import { toCustomerPortalError } from '@/lib/customer-portal/http';

/**
 * GET /api/portal/[workspaceSlug]/tickets/[ticketId]
 *
 * One customer-owned ticket, returned as an explicit customer-safe DTO.
 *
 * Authorization is `ticket.workspaceId === authenticated workspace AND
 * ticket.customerId === authenticated customer`, applied in the query rather
 * than after a fetch by id. A ticket belonging to another customer, or to a
 * customer of another workspace, therefore answers `404` — identical to a
 * ticket id that does not exist, so the endpoint never confirms that someone
 * else's ticket is real.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string; ticketId: string }> },
) {
  try {
    const { workspaceSlug, ticketId } = await params;

    const ticket = await getCustomerTicket({ workspaceSlug, ticketId });

    return NextResponse.json(ticket);
  } catch (error) {
    const { status, body } = toCustomerPortalError(error, 'Failed to load ticket');

    return NextResponse.json(body, { status });
  }
}
