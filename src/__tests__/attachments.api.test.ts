import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getMessageAttachments, POST as uploadAttachment } from '@/app/api/messages/[id]/attachments/route';
import { GET as downloadAttachment, DELETE as deleteAttachment } from '@/app/api/attachments/[id]/route';
import { AttachmentNotFoundError, AttachmentValidationError, MessageNotFoundError } from '@/lib/attachments/service';
import { UnauthorizedError, ForbiddenError, getCurrentMembership } from '@/lib/workspace/server';

vi.mock('@/lib/attachments/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/attachments/service')>();
  return {
    ...actual,
    attachmentService: {
      getAttachmentsByMessage: vi.fn(),
      uploadAttachment: vi.fn(),
      downloadAttachment: vi.fn(),
      deleteAttachment: vi.fn(),
    },
  };
});

vi.mock('@/lib/workspace/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/server')>();
  return {
    ...actual,
    getCurrentMembership: vi.fn(),
  };
});

const mockedAttachmentService = vi.mocked((await import('@/lib/attachments/service')).attachmentService);
const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

function createMessageAttachmentsRequest(init?: RequestInit) {
  return new NextRequest('http://localhost/api/messages/message-1/attachments', {
    ...init,
    signal: undefined,
  });
}

function createAttachmentRequest(init?: RequestInit) {
  return new NextRequest('http://localhost/api/attachments/attachment-1', {
    ...init,
    signal: undefined,
  });
}

const fakeMembership = {
  userId: 'user-123',
  workspaceId: 'workspace-1',
  workspace: {
    id: 'workspace-1',
    name: 'Workspace 1',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

afterEach(() => {
  mockedAttachmentService.getAttachmentsByMessage.mockReset();
  mockedAttachmentService.uploadAttachment.mockReset();
  mockedAttachmentService.downloadAttachment.mockReset();
  mockedAttachmentService.deleteAttachment.mockReset();
  mockedGetCurrentMembership.mockReset();
  vi.restoreAllMocks();
});

describe('GET /api/messages/:id/attachments', () => {
  it('returns 401 when unauthorized', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(new UnauthorizedError());

    const response = await getMessageAttachments(createMessageAttachmentsRequest(), { params: Promise.resolve({ id: 'message-1' }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 when forbidden', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(new ForbiddenError());

    const response = await getMessageAttachments(createMessageAttachmentsRequest(), { params: Promise.resolve({ id: 'message-1' }) });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('returns attachments for authorized user', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedAttachmentService.getAttachmentsByMessage.mockResolvedValueOnce([
      {
        id: 'attachment-1',
        messageId: 'message-1',
        originalFilename: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        createdAt: new Date(),
      },
    ] as never);

    const response = await getMessageAttachments(createMessageAttachmentsRequest(), { params: Promise.resolve({ id: 'message-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].originalFilename).toBe('test.pdf');
  });

  it('returns 404 when message not found', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedAttachmentService.getAttachmentsByMessage.mockRejectedValueOnce(new MessageNotFoundError());

    const response = await getMessageAttachments(createMessageAttachmentsRequest(), { params: Promise.resolve({ id: 'nonexistent' }) });

    expect(response.status).toBe(404);
  });
});

describe('POST /api/messages/:id/attachments', () => {
  it('returns 401 when unauthorized', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(new UnauthorizedError());

    const formData = new FormData();
    const response = await uploadAttachment(createMessageAttachmentsRequest({ method: 'POST', body: formData }), { params: Promise.resolve({ id: 'message-1' }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 400 when no file is provided', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);

    const formData = new FormData();
    const response = await uploadAttachment(createMessageAttachmentsRequest({ method: 'POST', body: formData }), { params: Promise.resolve({ id: 'message-1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('File wajib diisi');
  });

  it('returns 400 when validation fails', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedAttachmentService.uploadAttachment.mockRejectedValueOnce(new AttachmentValidationError('Tipe file tidak diizinkan'));

    const formData = new FormData();
    formData.append('file', new Blob(['test'], { type: 'application/octet-stream' }), 'test.exe');

    const response = await uploadAttachment(createMessageAttachmentsRequest({ method: 'POST', body: formData }), { params: Promise.resolve({ id: 'message-1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Tipe file tidak diizinkan');
  });

  it('returns 201 when upload succeeds', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedAttachmentService.uploadAttachment.mockResolvedValueOnce({
      id: 'attachment-1',
      messageId: 'message-1',
      originalFilename: 'test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      createdAt: new Date(),
    } as never);

    const formData = new FormData();
    formData.append('file', new Blob(['test'], { type: 'application/pdf' }), 'test.pdf');

    const response = await uploadAttachment(createMessageAttachmentsRequest({ method: 'POST', body: formData }), { params: Promise.resolve({ id: 'message-1' }) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('attachment-1');
  });
});

describe('GET /api/attachments/:id (download)', () => {
  it('returns 401 when unauthorized', async () => {
    mockedAttachmentService.downloadAttachment.mockRejectedValueOnce(new UnauthorizedError());

    const response = await downloadAttachment(createAttachmentRequest(), { params: Promise.resolve({ id: 'attachment-1' }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when attachment not found', async () => {
    mockedAttachmentService.downloadAttachment.mockRejectedValueOnce(new AttachmentNotFoundError());

    const response = await downloadAttachment(createAttachmentRequest(), { params: Promise.resolve({ id: 'nonexistent' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Attachment not found');
  });

  it('returns file buffer when authorized', async () => {
    mockedAttachmentService.downloadAttachment.mockResolvedValueOnce({
      buffer: Buffer.from('test content'),
      originalFilename: 'test.pdf',
      mimeType: 'application/pdf',
    } as never);

    const response = await downloadAttachment(createAttachmentRequest(), { params: Promise.resolve({ id: 'attachment-1' }) });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
  });
});

describe('DELETE /api/attachments/:id', () => {
  it('returns 401 when unauthorized', async () => {
    mockedAttachmentService.deleteAttachment.mockRejectedValueOnce(new UnauthorizedError());

    const response = await deleteAttachment(createAttachmentRequest(), { params: Promise.resolve({ id: 'attachment-1' }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when attachment not found', async () => {
    mockedAttachmentService.deleteAttachment.mockRejectedValueOnce(new AttachmentNotFoundError());

    const response = await deleteAttachment(createAttachmentRequest(), { params: Promise.resolve({ id: 'nonexistent' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Attachment not found');
  });

  it('returns 200 when deletion succeeds', async () => {
    mockedAttachmentService.deleteAttachment.mockResolvedValueOnce(undefined);

    const response = await deleteAttachment(createAttachmentRequest(), { params: Promise.resolve({ id: 'attachment-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
