import { NextResponse } from 'next/server';
import { createCustomer, getCustomers } from '@/lib/customers/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { createCustomerSchema } from '@/lib/customers/schema';

export async function GET() {
  try {
    const customers = await getCustomers();
    return NextResponse.json(customers);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load customers' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = createCustomerSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid customer payload' },
        { status: 400 },
      );
    }

    const customer = await createCustomer(parsed.data);
    return NextResponse.json(customer, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 });
  }
}
