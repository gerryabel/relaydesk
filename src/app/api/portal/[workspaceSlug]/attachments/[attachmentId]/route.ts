import { NextResponse, type NextRequest } from 'next/server';
import { downloadCustomerAttachment } from '@/lib/customer-portal/attachments';
import { toCustomerPortalError } from '@/lib/customer-portal/http';
import { buildAttachmentContentDisposition } from '@/lib/attachments/filename';

/**
 * GET /api/portal/[workspaceSlug]/attachments/[attachmentId]
 *
 * Streams an attachment the authenticated customer is entitled to download
 * (Phase 9 Task 4).
 *
 * | Status | Meaning |
 * | --- | --- |
 * | 200 | the file bytes |
 * | 401 | no customer session |
 * | 403 | session belongs to another workspace |
 * | 404 | unknown id, another customer's, another workspace's, or not customer-visible |
 * | 500 | anything else, with a fixed message |
 *
 * **An attachment id is never sufficient.** The service authorizes
 * `attachment -> message -> ticket -> (workspaceId, customerId)` plus the
 * customer-visible author type in a single database predicate, and every
 * failure of that predicate — missing, foreign, cross-workspace, internal-only —
 * produces the identical `404 { error: 'Not found' }` body. There is no
 * "exists but forbidden" answer to distinguish.
 *
 * That check happens here, on this route, every time. The portal DTO does carry
 * an attachment id, and that id appearing in a customer's conversation JSON is
 * *not* the authorization: it is a render hint. A caller who writes
 * `/api/portal/<their-slug>/attachments/<any-id>` by hand gets the same `404`.
 *
 * Response headers:
 *
 *  - `Content-Type` is the stored MIME type, which passed the shared allowlist
 *    at upload. It is not trusted to be inert, which is why
 *    `X-Content-Type-Options: nosniff` is set and the body is always a download
 *    rather than something a browser might render inline.
 *  - `Content-Disposition` is built by {@link buildAttachmentContentDisposition},
 *    which sanitizes the filename first and then emits both the quoted ASCII
 *    fallback and the RFC 5987 `filename*` form. No substring of a
 *    customer-controlled filename is interpolated into the header unescaped.
 *  - `Cache-Control: private, no-store` — the response is per-customer. A shared
 *    or cached copy could be served to the next requester.
 *
 * Storage is not reached until the predicate has matched: a foreign id costs one
 * `SELECT` and no filesystem access.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string; attachmentId: string }> },
) {
  try {
    const { workspaceSlug, attachmentId } = await params;

    const file = await downloadCustomerAttachment({ workspaceSlug, attachmentId });

    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': buildAttachmentContentDisposition(file.filename),
        'Content-Length': String(file.buffer.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const { status, body } = toCustomerPortalError(error, 'Failed to download attachment');

    return NextResponse.json(body, { status });
  }
}