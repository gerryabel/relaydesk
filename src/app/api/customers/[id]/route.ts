import { NextResponse } from 'next/server';
import { getCustomerById, updateCustomer, CustomerNotFoundError } from '@/lib/customers/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { updateCustomerSchema } from '@/lib/customers/schema';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const customer = await getCustomerById(resolved.id);
    return NextResponse.json(customer);
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
    return NextResponse.json({ error: 'Failed to load customer' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const payload = await request.json();
    const parsed = updateCustomerSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid customer payload' },
        { status: 400 },
      );
    }

    const customer = await updateCustomer(resolved.id, parsed.data);
    return NextResponse.json(customer);
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
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 });
  }
}
