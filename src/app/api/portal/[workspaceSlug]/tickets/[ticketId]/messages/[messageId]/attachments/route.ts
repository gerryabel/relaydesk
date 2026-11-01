import { NextResponse, type NextRequest } from 'next/server';
import { uploadCustomerAttachment } from '@/lib/customer-portal/attachments';
import { toCustomerPortalError } from '@/lib/customer-portal/http';
import type { CustomerAttachmentView } from '@/lib/customer-portal/dto';
import { attachmentConfig } from '@/lib/attachments/config';

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
 * | 413 | request body exceeds the configured total limit |
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
 *  - rejects the request before buffering when the declared `Content-Length`
 *    exceeds the configured maximum plus multipart overhead, so an obviously
 *    oversized upload cannot force unbounded memory allocation;
 *  - streams the request body through a byte counter and aborts with 413 as
 *    soon as the total body limit is exceeded, regardless of whether
 *    `Content-Length` was declared;
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

    const contentLength = request.headers.get('content-length');
    if (contentLength !== null) {
      const declaredLength = Number(contentLength);
      // Reject obviously oversized multipart bodies before parsing. The limit
      // is the configured file maximum plus 1 MiB for form-data overhead.
      if (
        declaredLength > attachmentConfig.maxFileSizeBytes + 1024 * 1024
      ) {
        return NextResponse.json(
          { error: 'The request body is too large.' },
          { status: 413 },
        );
      }
    }

    const { formData, limitExceeded } = await readFormDataWithLimit(
      request,
      attachmentConfig.maxFileSizeBytes + 1024 * 1024,
    );

    if (limitExceeded) {
      return NextResponse.json(
        { error: 'The request body is too large.' },
        { status: 413 },
      );
    }

    if (formData === null) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'A file is required.' }, { status: 400 });
    }

    if (file.size > attachmentConfig.maxFileSizeBytes) {
      return NextResponse.json(
        { error: `The file is larger than the ${Math.floor(attachmentConfig.maxFileSizeBytes / (1024 * 1024))} MB limit.` },
        { status: 400 },
      );
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
 * Streams the request body through a byte counter.
 *
 * Returns the parsed FormData and a flag indicating whether the total body
 * exceeded the configured limit. When the limit is exceeded, the body is
 * aborted early and `limitExceeded` is true; `formData` is null in that case.
 *
 * `Content-Length` early rejection is handled by the caller; this helper
 * provides the actual streaming enforcement.
 */
async function readFormDataWithLimit(
  request: NextRequest,
  limit: number,
): Promise<{ formData: FormData | null; limitExceeded: boolean }> {
  if (!request.body) {
    return { formData: null, limitExceeded: false };
  }

  let bytesRead = 0;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      bytesRead += value.byteLength;
      if (bytesRead > limit) {
        return { formData: null, limitExceeded: true };
      }

      chunks.push(value);
    }
  } finally {
    // Explicitly release the reader so undici's internal byte-stream
    // controller does not enqueue into an already-closed stream after
    // this function returns ( manifests as ERR_INVALID_STATE in tests ).
    try {
      await reader.cancel();
    } catch {
      // best-effort
    }
  }

  const blob = new Blob(chunks as unknown as BlobPart[]);
  const limitedRequest = new Request(request, { body: blob });
  const formData = await limitedRequest.formData();
  return { formData, limitExceeded: false };
}
