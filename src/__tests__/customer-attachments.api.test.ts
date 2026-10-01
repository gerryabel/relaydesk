import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as uploadAttachment } from '@/app/api/portal/[workspaceSlug]/tickets/[ticketId]/messages/[messageId]/attachments/route';
import { GET as downloadAttachment } from '@/app/api/portal/[workspaceSlug]/attachments/[attachmentId]/route';
import {
  CustomerAttachmentNotFoundError,
  CustomerAttachmentStorageError,
  CustomerAttachmentValidationError,
} from '@/lib/customer-portal/attachments';
import {
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
  WorkspaceSlugNotFoundError,
} from '@/lib/customer-access/errors';
import { attachmentConfig } from '@/lib/attachments/config';

/**
 * Customer attachment HTTP surface (Phase 9 Task 4).
 *
 * The service is mocked, so what is under test is the *boundary*: status codes,
 * headers, and — the reason these tests exist — that nothing about the storage
 * layer, the internal schema, or the existence of another customer's data can
 * escape through a response.
 *
 * The download endpoint returns raw bytes, so the assertions below are mostly
 * about headers and byte equality rather than JSON.
 */

vi.mock('@/lib/customer-portal/attachments', async (importOriginal) => {
  // The error classes stay real: the route's status mapping keys on `instanceof`,
  // and a stubbed class would make every error look like an unknown one.
  const actual =
    await importOriginal<typeof import('@/lib/customer-portal/attachments')>();

  return {
    ...actual,
    uploadCustomerAttachment: vi.fn(),
    downloadCustomerAttachment: vi.fn(),
  };
});

const { uploadCustomerAttachment, downloadCustomerAttachment } = await import(
  '@/lib/customer-portal/attachments'
);

const mockedUpload = vi.mocked(uploadCustomerAttachment);
const mockedDownload = vi.mocked(downloadCustomerAttachment);

const slug = 'acme-support';
const ticketId = 'ticket-1';
const messageId = 'message-1';
const attachmentId = 'attachment-1';

const uploadContext = {
  params: Promise.resolve({ workspaceSlug: slug, ticketId, messageId }),
};
const downloadContext = {
  params: Promise.resolve({ workspaceSlug: slug, attachmentId }),
};

const pdfBytes = Buffer.from('%PDF-1.7 fake');

function uploadRequest(file: File | null): NextRequest {
  const form = new FormData();

  if (file) {
    form.append('file', file);
  }

  return new NextRequest(
    `http://localhost:3000/api/portal/${slug}/tickets/${ticketId}/messages/${messageId}/attachments`,
    { method: 'POST', body: form },
  );
}

function downloadRequest(): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/portal/${slug}/attachments/${attachmentId}`,
  );
}

/**
 * The service's return type as the route sees it. `createdAt` is an ISO string,
 * because the DTO is a JSON boundary and the route's allowlist projection is
 * typed against it — which is what turns a widened service response into a
 * compile error rather than a leak.
 */
const storedAttachment = {
  id: attachmentId,
  originalFilename: 'invoice.pdf',
  mimeType: 'application/pdf',
  sizeBytes: pdfBytes.length,
  createdAt: '2026-02-01T10:00:00.000Z',
};

beforeEach(() => {
  mockedUpload.mockResolvedValue(storedAttachment);
  mockedDownload.mockResolvedValue({
    buffer: pdfBytes,
    filename: 'invoice.pdf',
    mimeType: 'application/pdf',
    sizeBytes: pdfBytes.length,
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('POST .../messages/[messageId]/attachments', () => {
  it('uploads a file and answers 201', async () => {
    const response = await uploadAttachment(
      uploadRequest(new File([pdfBytes], 'invoice.pdf', { type: 'application/pdf' })),
      uploadContext,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: attachmentId,
      originalFilename: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdfBytes.length,
    });
  });

  it('sends the decoded bytes and the declared name and type', async () => {
    await uploadAttachment(
      uploadRequest(new File([pdfBytes], 'invoice.pdf', { type: 'application/pdf' })),
      uploadContext,
    );

    const input = mockedUpload.mock.calls[0]?.[0] as {
      buffer: Buffer;
      declaredFilename: string;
      declaredMimeType: string;
    };

    expect(input.buffer.equals(pdfBytes)).toBe(true);
    expect(input.declaredFilename).toBe('invoice.pdf');
    expect(input.declaredMimeType).toBe('application/pdf');
  });

  it('passes the route ids as lookup keys and nothing else', async () => {
    await uploadAttachment(
      uploadRequest(new File([pdfBytes], 'invoice.pdf', { type: 'application/pdf' })),
      uploadContext,
    );

    const input = mockedUpload.mock.calls[0]?.[0] as Record<string, unknown>;

    // All four are the URL's, and all four are keys the service re-checks
    // against the session. There is no `customerId` or `workspaceId` parameter
    // for a caller to fill in.
    expect(input).toMatchObject({ workspaceSlug: slug, ticketId, messageId });
    expect(Object.keys(input).sort()).toEqual([
      'buffer',
      'declaredFilename',
      'declaredMimeType',
      'messageId',
      'ticketId',
      'workspaceSlug',
    ]);
  });

  it('answers 404 when the message is not an owned customer message', async () => {
    mockedUpload.mockRejectedValue(new CustomerAttachmentNotFoundError());

    const response = await uploadAttachment(
      uploadRequest(new File([pdfBytes], 'invoice.pdf', { type: 'application/pdf' })),
      uploadContext,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: expect.any(String) });
  });

  it('answers 400 for a rejected file and says nothing about the server', async () => {
    mockedUpload.mockRejectedValue(
      new CustomerAttachmentValidationError('File type is not allowed'),
    );

    const response = await uploadAttachment(
      uploadRequest(new File([pdfBytes], 'evil.exe', { type: 'application/x-executable' })),
      uploadContext,
    );

    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };

    // Actionable for the customer, inert for an attacker: no allowed-type list,
    // no config path, no stack frame.
    expect(body.error).toBe('File type is not allowed');
    expect(body.error).not.toMatch(/storage|postgres|prisma|\/srv|node_modules/i);
  });

  it('answers 400 when the request carries no file', async () => {
    // A body the route cannot parse into a file must not reach the service, so
    // there is no buffer to validate and no storage write.
    mockedUpload.mockRejectedValue(
      new CustomerAttachmentValidationError('A file is required'),
    );

    const response = await uploadAttachment(uploadRequest(null), uploadContext);

    expect(response.status).toBe(400);
  });

  it('answers 500 for a storage failure without echoing its cause', async () => {
    mockedUpload.mockRejectedValue(
      new CustomerAttachmentStorageError(
        'EACCES: /srv/relaydesk/storage/attachments',
      ),
    );

    const response = await uploadAttachment(
      uploadRequest(new File([pdfBytes], 'invoice.pdf', { type: 'application/pdf' })),
      uploadContext,
    );

    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: string };

    expect(body.error).not.toContain('/srv');
    expect(body.error).not.toContain('EACCES');
  });

  it('answers 401 without a session', async () => {
    mockedUpload.mockRejectedValue(new CustomerUnauthenticatedError());

    const response = await uploadAttachment(
      uploadRequest(new File([pdfBytes], 'invoice.pdf', { type: 'application/pdf' })),
      uploadContext,
    );

    expect(response.status).toBe(401);
  });

  it('answers 403 for a session bound to another workspace', async () => {
    mockedUpload.mockRejectedValue(new CustomerWorkspaceMismatchError());

    const response = await uploadAttachment(
      uploadRequest(new File([pdfBytes], 'invoice.pdf', { type: 'application/pdf' })),
      uploadContext,
    );

    expect(response.status).toBe(403);
  });

  it('answers 404 for an unknown workspace', async () => {
    mockedUpload.mockRejectedValue(new WorkspaceSlugNotFoundError());

    const response = await uploadAttachment(
      uploadRequest(new File([pdfBytes], 'invoice.pdf', { type: 'application/pdf' })),
      uploadContext,
    );

    // Deliberately 404 rather than 403: confirming which slugs exist would map
    // out tenants for an unauthenticated caller.
    expect(response.status).toBe(404);
  });

  it('answers 500 for an unknown error without leaking its message', async () => {
    mockedUpload.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5432 /srv/relaydesk'),
    );

    const response = await uploadAttachment(
      uploadRequest(new File([pdfBytes], 'invoice.pdf', { type: 'application/pdf' })),
      uploadContext,
    );

    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: string };

    expect(body.error).not.toContain('ECONNREFUSED');
    expect(body.error).not.toContain('5432');
    expect(body.error).not.toContain('/srv');
  });

  it('never returns a storage key in the 201 body', async () => {
    mockedUpload.mockResolvedValue({
      ...storedAttachment,
      storageKey: 'attachments/6f1b0b8e-1f0a-4a6b-9b3a-6d2f2a1c0e11',
      messageId,
      customerId: 'customer-1',
    } as never);

    const response = await uploadAttachment(
      uploadRequest(new File([pdfBytes], 'invoice.pdf', { type: 'application/pdf' })),
      uploadContext,
    );

    const raw = await response.text();

    expect(raw).not.toContain('storageKey');
    expect(raw).not.toContain('6f1b0b8e');
    expect(raw).not.toContain('customerId');
    expect(raw).not.toContain(messageId);
  });
});

describe('GET /api/portal/[workspaceSlug]/attachments/[attachmentId]', () => {
  it('returns the bytes with the stored type', async () => {
    const response = await downloadAttachment(downloadRequest(), downloadContext);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    await expect(response.arrayBuffer()).resolves.toEqual(
      pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength,
      ),
    );
  });

  it('forwards the workspace slug and attachment id only', async () => {
    await downloadAttachment(downloadRequest(), downloadContext);

    const input = mockedDownload.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(input).toEqual({ workspaceSlug: slug, attachmentId });
  });

  it('sets a safe Content-Disposition', async () => {
    const response = await downloadAttachment(downloadRequest(), downloadContext);

    const disposition = response.headers.get('content-disposition') ?? '';

    expect(disposition).toMatch(/^attachment;/);
    expect(disposition).toContain('filename="invoice.pdf"');
    expect(disposition).toContain("filename*=UTF-8''invoice.pdf");
  });

  it.each([
    ['../../etc/passwd'],
    ['..\\..\\windows\\system32\\config'],
    ['evil".txt'],
    ['a\r\nX-Injected: 1\r\nb.txt'],
    ['invoice\u202Etxt.exe'],
    ['..'],
  ])('neutralizes %j in the header', async (storedName) => {
    mockedDownload.mockResolvedValue({
      buffer: pdfBytes,
      filename: storedName,
      mimeType: 'application/pdf',
      sizeBytes: pdfBytes.length,
    });

    const response = await downloadAttachment(downloadRequest(), downloadContext);

    const disposition = response.headers.get('content-disposition') ?? '';

    // What matters on a response header is structural, not lexical. The literal
    // text "X-Injected" appearing inside a quoted filename is inert; what would
    // be catastrophic is the CRLF that would end the header line and start a
    // second one. So the assertions are: one line, and a filename confined to
    // the quoted string.
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).not.toContain('..');

    // Every parameter value is ASCII within `[A-Za-z0-9._-]`, which cannot
    // terminate a quoted-string or introduce a directive.
    const [, ...params] = disposition.split(';').map((part) => part.trim());
    expect(params.length).toBeGreaterThan(0);

    for (const param of params) {
      const value = param.slice(param.indexOf('=') + 1).replace(/^"|"$/g, '');

      expect(value).toMatch(/^[A-Za-z0-9._~%'-]*$/);
    }
  });

  it('reduces a traversal name to a bare basename rather than refusing the download', async () => {
    mockedDownload.mockResolvedValue({
      buffer: pdfBytes,
      filename: '../../etc/passwd',
      mimeType: 'application/pdf',
      sizeBytes: pdfBytes.length,
    });

    const response = await downloadAttachment(downloadRequest(), downloadContext);

    // 200 with a sanitized name, not 400: refusing to serve an attachment
    // because of a bad *name* would break a legitimate download for a cosmetic
    // reason. The bytes are still authorized; only the name is rewritten.
    expect(response.status).toBe(200);

    const disposition = response.headers.get('content-disposition') ?? '';

    expect(disposition).toContain('filename="passwd"');
    expect(disposition).not.toContain('/');
    expect(disposition).not.toContain('..');
  });

  it('declares the length of the bytes actually being sent', async () => {
    const response = await downloadAttachment(downloadRequest(), downloadContext);

    // Not the stored `sizeBytes`: a metadata value that disagrees with the
    // payload would let a caller desync its own parser.
    expect(response.headers.get('content-length')).toBe(String(pdfBytes.length));
  });

  it('forbids MIME sniffing and type reinterpretation', async () => {
    const response = await downloadAttachment(downloadRequest(), downloadContext);

    // `attachment` plus `nosniff` is what keeps a stored `image/svg+xml` or
    // `text/html` from executing in the portal's origin on the way to a save
    // dialog.
    expect(response.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('is not cacheable by shared caches', async () => {
    const response = await downloadAttachment(downloadRequest(), downloadContext);

    const cacheControl = response.headers.get('cache-control') ?? '';

    expect(cacheControl).toContain('private');
    expect(cacheControl).toContain('no-store');
  });

  it('answers 404 for a foreign attachment', async () => {
    mockedDownload.mockRejectedValue(new CustomerAttachmentNotFoundError());

    const response = await downloadAttachment(downloadRequest(), downloadContext);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: expect.any(String) });
  });

  it('gives a foreign attachment and a missing one the same body', async () => {
    mockedDownload.mockRejectedValue(new CustomerAttachmentNotFoundError());

    const foreign = await (
      await downloadAttachment(downloadRequest(), downloadContext)
    ).json();
    const missing = await (
      await downloadAttachment(
        new NextRequest(`http://localhost:3000/api/portal/${slug}/attachments/does-not-exist`),
        { params: Promise.resolve({ workspaceSlug: slug, attachmentId: 'does-not-exist' }) },
      )
    ).json();

    // A distinguishing status, header or body would be an oracle for which
    // attachment ids exist.
    expect(foreign).toEqual(missing);
  });

  it('answers 401 without a session and 403 across workspaces', async () => {
    mockedDownload.mockRejectedValueOnce(new CustomerUnauthenticatedError());
    const unauthenticated = await downloadAttachment(downloadRequest(), downloadContext);

    mockedDownload.mockRejectedValueOnce(new CustomerWorkspaceMismatchError());
    const crossWorkspace = await downloadAttachment(downloadRequest(), downloadContext);

    expect(unauthenticated.status).toBe(401);
    expect(crossWorkspace.status).toBe(403);
  });

  it('answers 500 when the object is missing from storage', async () => {
    mockedDownload.mockRejectedValue(
      new CustomerAttachmentStorageError('ENOENT: no such file or directory'),
    );

    const response = await downloadAttachment(downloadRequest(), downloadContext);

    // Not 404: the metadata row exists and is this customer's, so claiming
    // "not found" would be false and would misdirect a support conversation.
    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: string };

    expect(body.error).not.toContain('ENOENT');
  });

  it('answers 500 for an unknown error without leaking its message', async () => {
    mockedDownload.mockRejectedValue(new Error('AWS error: bucket does not exist'));

    const response = await downloadAttachment(downloadRequest(), downloadContext);

    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: string };

    expect(body.error).not.toContain('AWS');
    expect(body.error).not.toContain('bucket');
  });

  it('never returns a storage key as a header', async () => {
    mockedDownload.mockResolvedValue({
      buffer: pdfBytes,
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdfBytes.length,
      storageKey: 'attachments/6f1b0b8e-1f0a-4a6b-9b3a-6d2f2a1c0e11',
    } as never);

    const response = await downloadAttachment(downloadRequest(), downloadContext);

    for (const [, value] of response.headers) {
      expect(value).not.toContain('6f1b0b8e');
      expect(value).not.toContain('attachments/');
    }
  });

  it('serves the allowed type from config verbatim, without sniffing', async () => {
    // The type comes from the allowlist-checked declaration, so a customer
    // cannot get `text/html` served from the portal's origin.
    for (const mimeType of attachmentConfig.allowedMimeTypes) {
      mockedDownload.mockResolvedValueOnce({
        buffer: pdfBytes,
        filename: 'file.bin',
        mimeType,
        sizeBytes: pdfBytes.length,
      });

      const response = await downloadAttachment(downloadRequest(), downloadContext);

      expect(response.headers.get('content-type')).toBe(mimeType);
    }

    expect(attachmentConfig.allowedMimeTypes).not.toContain('text/html');
    expect(attachmentConfig.allowedMimeTypes).not.toContain('image/svg+xml');
    expect(attachmentConfig.allowedMimeTypes).not.toContain('application/javascript');
  });
});