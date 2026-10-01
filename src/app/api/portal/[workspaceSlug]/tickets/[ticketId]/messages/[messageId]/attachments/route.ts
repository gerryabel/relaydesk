import { NextResponse, type NextRequest } from 'next/server';
import { uploadCustomerAttachment } from '@/lib/customer-portal/attachments';
import { toCustomerPortalError } from '@/lib/customer-portal/http';
import type { CustomerAttachmentView } from '@/lib/customer-portal/dto';

/**
 * POST /api/portal/[workspaceSlug]/tickets/[ticketId]/messages/[messageId]/attachments
 *
 * Attaches a file to a customer-authored message on a ticket the customer owns
 * (Phase 9 Task 4).
 *
 * | Status | Meaning |
 * | --- | --- |
 * | 201 | attachment stored, returns the customer-safe attachment DTO |
 * | 400 | no file, empty file, too large, disallowed type, too many files |
 * | 401 | no customer session |
 * | 403 | session belongs to another workspace |
 * | 404 | unknown ticket/message, another customer's, another workspace's, or not customer-authored |
 * | 500 | anything else, with a fixed message |
 *
 * This route deliberately does **not** share a handler with
 * `/api/messages/[id]/attachments`. That one authorizes with
 * `getCurrentMembership()`; merging the two would mean one handler deciding
 * which principal type the caller is, decided from the request. Two
 * authorization domains, two code paths, no branch between them.
 *
 * What the route does with the multipart body:
 *
 *  - reads exactly one `file` part, and rejects the request when it is absent or
 *    is a plain string field rather than a file;
 *  - derives `sizeBytes` from the received bytes, never from a form field or a
 *    declared length;
 *  - forwards the browser's declared MIME type and filename *as claims*, for the
 *    service to validate against the shared allowlist and to normalize. Neither
 *    is trusted for anything else, and neither reaches the storage path — the
 *    storage key is an opaque UUID.
 *
 * `ticketId` and `messageId` are route parameters, so they are lookup keys that
 * the service re-scopes by the session's `(workspaceId, customerId)`. Nothing
 * about identity is read from the body.
 */
export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ workspaceSlug: string; ticketId: string; messageId: string }>;
  },
) {
  try {
    const { workspaceSlug, ticketId, messageId } = await params;

    const formData = await readFormData(request);

    if (formData === null) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'A file is required.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const attachment = await uploadCustomerAttachment({
      workspaceSlug,
      ticketId,
      messageId,
      declaredFilename: file.name,
      declaredMimeType: file.type,
      buffer,
    });

    // Projected to an explicit allowlist rather than serialized as received.
    //
    // `uploadCustomerAttachment` already returns only these five fields, so
    // this is redundant today. That is the point: it makes the guarantee a
    // property of *this route* instead of a property of a module it calls. A
    // future field added to the service's DTO — or a `select: true` widened
    // somewhere upstream — then fails here rather than shipping `storageKey` to
    // a customer. The type annotation makes that a compile error first.
    const body: CustomerAttachmentView = {
      id: attachment.id,
      originalFilename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt,
    };

    return NextResponse.json(body, { status: 201 });
  } catch (error) {
    const { status, body } = toCustomerPortalError(error, 'Failed to upload attachment');

    return NextResponse.json(body, { status });
  }
}

/**
 * Parses the multipart body, treating an unparseable one as a bad request.
 *
 * A `Content-Type` that is not multipart makes `formData()` reject with a raw
 * exception; without this, a caller could distinguish "your body was
 * malformed" from every other `400` by the message, and — more importantly —
 * the raw exception would reach the generic branch with its type name in the
 * logs and a status a caller could learn from.
 */
async function readFormData(request: NextRequest): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}