import { NextResponse, type NextRequest } from 'next/server';
import {
  createCustomerTicket,
  listCustomerTickets,
} from '@/lib/customer-portal/server';
import { toCustomerPortalError } from '@/lib/customer-portal/http';
import { normalizeCustomerTicketListParams } from '@/lib/customer-portal/schema';

/**
 * GET /api/portal/[workspaceSlug]/tickets
 *
 * The authenticated customer's own tickets, scoped server-side by
 * `workspaceId` and `customerId` resolved from the customer session. A
 * customer cannot widen this by adding a parameter: only `q`, `status`,
 * `page` and `limit` are forwarded, and any other key is dropped before the
 * service is reached.
 *
 * POST /api/portal/[workspaceSlug]/tickets
 *
 * Creates a ticket for the authenticated customer. The body may contain only
 * `title` and `description`; the schema is strict, so an attempt to supply
 * `customerId`, `workspaceId`, `priority` or `status` is rejected rather than
 * ignored. Ownership is derived from the session.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await params;

    const page = await listCustomerTickets({
      workspaceSlug,
      params: normalizeCustomerTicketListParams(
        Object.fromEntries(request.nextUrl.searchParams.entries()),
      ),
    });

    return NextResponse.json(page);
  } catch (error) {
    const { status, body } = toCustomerPortalError(error, 'Failed to load tickets');

    return NextResponse.json(body, { status });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await params;
    const rawBody = await request.json().catch(() => null);

    const { ticket } = await createCustomerTicket({ workspaceSlug, rawInput: rawBody });

    return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    const { status, body } = toCustomerPortalError(error, 'Failed to create ticket');

    return NextResponse.json(body, { status });
  }
}
