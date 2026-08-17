import { NextResponse } from 'next/server';
import { getCustomerTickets, CustomerNotFoundError } from '@/lib/customers/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const tickets = await getCustomerTickets(resolved.id);
    return NextResponse.json(tickets);
  } catch (error) {
    if (error instanceof CustomerNotFoundError) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load customer tickets' }, { status: 500 });
  }
}
