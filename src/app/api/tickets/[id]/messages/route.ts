import { NextResponse } from 'next/server';
import { getCurrentMembership, ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { createMessageSchema } from '@/lib/messages/schema';
import { createMessage, getMessages } from '@/lib/messages/server';

/**
 * Internal (workspace) ticket conversation endpoint.
 *
 * Thin by design: it maps HTTP to the message service and back. Both verbs
 * delegate to `createMessage`/`getMessages` so the authorship invariant, the
 * `firstResponseAt` update and the customer email event are applied in one
 * place. This route used to insert `Message` rows itself, which is exactly
 * the bypass Task 3 removes — a direct write there could not have notified
 * the customer.
 *
 * Response shapes are unchanged, including the status a missing ticket
 * produces: it falls through to the generic 500 branch, exactly as it did when
 * this route queried Prisma and called `notFound()` itself.
 */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getCurrentMembership();
    const resolved = await params;

    const messages = await getMessages(resolved.id);

    return NextResponse.json(messages);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getCurrentMembership();
    const resolved = await params;
    const payload = await request.json();
    const parsed = createMessageSchema.safeParse(payload);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid message';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const message = await createMessage(resolved.id, parsed.data);

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to create message' }, { status: 500 });
  }
}
