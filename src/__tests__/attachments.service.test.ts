import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttachmentService, MessageNotFoundError, AttachmentValidationError, StorageError, AttachmentNotFoundError } from '@/lib/attachments/service';
import type { StorageProvider } from '@/lib/attachments/storage.interface';
import { getCurrentMembership } from '@/lib/workspace/server';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

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

function makeFakeMessage(workspaceId = 'workspace-1') {
  return {
    id: 'message-1',
    ticketId: 'ticket-1',
    createdById: 'user-123',
    body: 'Test message',
    createdAt: new Date(),
    updatedAt: new Date(),
    ticket: { workspaceId },
  };
}

const createMockStorage = (): StorageProvider => ({
  put: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(Buffer.from('test')),
  delete: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(true),
});

let storage: StorageProvider;

vi.mock('@/lib/db/prisma', () => {
  const attachment = {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue({}),
  };

  // Echoes its input the way a real database does, so a test that asserts on a
  // persisted value reads back what the service actually wrote rather than a
  // canned row that would mask it.
  attachment.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'attachment-1',
        createdAt: new Date(),
        ...data,
      }),
  );

  const ticketActivity = {
    create: vi.fn().mockResolvedValue({}),
  };

  const message = {
    findFirst: vi.fn().mockResolvedValue(makeFakeMessage()),
  };

  const prisma = {
    attachment,
    ticketActivity,
    message,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn({ attachment, ticketActivity, message })),
  };

  return { prisma };
});

beforeEach(() => {
  storage = createMockStorage();
  mockedGetCurrentMembership.mockReset();
  vi.clearAllMocks();
});

describe('AttachmentService.uploadAttachment', () => {
  it('uploads a valid file and creates attachment metadata', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const service = new AttachmentService(storage);
    const result = await service.uploadAttachment(
      'message-1',
      { filename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
      Buffer.from('test file content'),
    );

    expect(result).toMatchObject({
      id: 'attachment-1',
      messageId: 'message-1',
      originalFilename: 'test.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('rejects empty file buffer', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const service = new AttachmentService(storage);
    await expect(
      service.uploadAttachment('message-1', { filename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1 }, Buffer.alloc(0)),
    ).rejects.toThrow(AttachmentValidationError);
  });

  it('rejects oversized file', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const service = new AttachmentService(storage);
    await expect(
      service.uploadAttachment('message-1', { filename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 11 * 1024 * 1024 }, Buffer.alloc(11 * 1024 * 1024)),
    ).rejects.toThrow(AttachmentValidationError);
  });

  it('rejects unsupported MIME type', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const service = new AttachmentService(storage);
    await expect(
      service.uploadAttachment('message-1', { filename: 'test.exe', mimeType: 'application/x-executable', sizeBytes: 1024 }, Buffer.alloc(1)),
    ).rejects.toThrow(AttachmentValidationError);
  });

  describe('persists the normalized MIME type (OMP remediation)', () => {
    // The internal writer is the other writer of `Attachment.mimeType`. It used
    // to persist the raw parsed string, so anything that reached storage was
    // whatever the client typed; a future loosening of the allowlist, or another
    // code path, would store a value that later reached a `Content-Type` header
    // unexamined.
    async function storedMimeType(declaredMimeType: string) {
      mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

      const service = new AttachmentService(storage);

      const result = await service.uploadAttachment(
        'message-1',
        { filename: 'test.txt', mimeType: declaredMimeType, sizeBytes: 1024 },
        Buffer.from('body'),
      );

      // Read what was written to the database, not just the returned DTO — the
      // two agreeing is the point, and asserting only the return value could be
      // satisfied by a sanitizing read path.
      const createMock = prisma.attachment.create as unknown as {
        mock: { calls: { data: Record<string, unknown> }[][] };
      };

      const written = createMock.mock.calls.at(-1)?.[0]?.data;

      expect(written?.mimeType).toBe(result.mimeType);

      return written?.mimeType as string;
    }

    it.each([
      ['TEXT/PLAIN', 'text/plain'],
      ['text/plain; charset=utf-8', 'text/plain'],
      ['TEXT/PLAIN; charset=UTF-8', 'text/plain'],
      ['  text/plain  ', 'text/plain'],
      ['application/PDF', 'application/pdf'],
    ])('stores %j as %j', async (declared, expected) => {
      expect(await storedMimeType(declared)).toBe(expected);
    });

    it('does not widen the allowlist while normalizing', async () => {
      // Normalization happens *before* the allowlist check, so the set of
      // accepted types must be byte-identical to before. These are rejected for
      // a reason unrelated to case or parameters.
      for (const rejected of [
        'application/x-executable',
        'application/javascript',
        'image/svg+xml',
        'text/html',
        'text;foo',
        'application/octet-stream',
      ]) {
        mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

        const service = new AttachmentService(storage);

        await expect(
          service.uploadAttachment(
            'message-1',
            { filename: 'test.bin', mimeType: rejected, sizeBytes: 1024 },
            Buffer.from('body'),
          ),
        ).rejects.toThrow(AttachmentValidationError);
      }
    });

    it('never stores a value containing CRLF', async () => {
      // The hostile shapes from the customer download path, asserted at the
      // write so they never reach storage at all.
      for (const hostile of [
        'text/plain\r\nX-Injected: yes',
        'text/plain\nSet-Cookie: a=b',
        '\r\nContent-Type: text/html',
      ]) {
        mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

        const service = new AttachmentService(storage);

        await expect(
          service.uploadAttachment(
            'message-1',
            { filename: 'test.txt', mimeType: hostile, sizeBytes: 1024 },
            Buffer.from('body'),
          ),
        ).rejects.toThrow(AttachmentValidationError);
      }
    });
  });

  it('throws MessageNotFoundError for nonexistent message', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const prisma = await import('@/lib/db/prisma');
    vi.mocked(prisma.prisma.message.findFirst).mockResolvedValueOnce(null as never);

    const service = new AttachmentService(storage);
    await expect(
      service.uploadAttachment('nonexistent', { filename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }, Buffer.alloc(1)),
    ).rejects.toThrow(MessageNotFoundError);
  });

  it('throws MessageNotFoundError when message is in another workspace', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const prisma = await import('@/lib/db/prisma');
    vi.mocked(prisma.prisma.message.findFirst).mockResolvedValueOnce(makeFakeMessage('other-workspace') as never);

    const service = new AttachmentService(storage);
    await expect(
      service.uploadAttachment('message-1', { filename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }, Buffer.alloc(1)),
    ).rejects.toThrow(MessageNotFoundError);
  });

  it('cleans up storage when DB insert fails', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const prisma = await import('@/lib/db/prisma');
    vi.mocked(prisma.prisma.message.findFirst).mockResolvedValueOnce(makeFakeMessage() as never);
    vi.mocked(prisma.prisma.$transaction).mockRejectedValueOnce(new Error('DB error'));

    const service = new AttachmentService(storage);
    await expect(
      service.uploadAttachment('message-1', { filename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }, Buffer.alloc(1)),
    ).rejects.toThrow('DB error');

    expect(storage.delete).toHaveBeenCalled();
  });

  it('throws StorageError when storage put fails', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const prisma = await import('@/lib/db/prisma');
    vi.mocked(prisma.prisma.message.findFirst).mockResolvedValueOnce(makeFakeMessage() as never);

    const failingStorage: StorageProvider = {
      put: vi.fn().mockRejectedValue(new Error('disk full')),
      get: vi.fn().mockResolvedValue(Buffer.from('test')),
      delete: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
    };

    const service = new AttachmentService(failingStorage);
    await expect(
      service.uploadAttachment('message-1', { filename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }, Buffer.alloc(1)),
    ).rejects.toThrow(StorageError);
  });
});

describe('AttachmentService.getAttachmentsByMessage', () => {
  it('returns attachments for a valid message', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const prisma = await import('@/lib/db/prisma');
    vi.mocked(prisma.prisma.message.findFirst).mockResolvedValueOnce(makeFakeMessage() as never);
    vi.mocked(prisma.prisma.attachment.findMany).mockResolvedValueOnce([
      {
        id: 'attachment-1',
        messageId: 'message-1',
        originalFilename: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        createdAt: new Date(),
      },
    ] as never);

    const service = new AttachmentService(storage);
    const result = await service.getAttachmentsByMessage('message-1');

    expect(result).toHaveLength(1);
    expect(result[0].originalFilename).toBe('test.pdf');
  });

  it('throws MessageNotFoundError for message in another workspace', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const prisma = await import('@/lib/db/prisma');
    vi.mocked(prisma.prisma.message.findFirst).mockResolvedValueOnce(makeFakeMessage('other-workspace') as never);

    const service = new AttachmentService(storage);
    await expect(service.getAttachmentsByMessage('message-1')).rejects.toThrow(MessageNotFoundError);
  });
});

describe('AttachmentService.downloadAttachment', () => {
  it('returns file buffer and metadata', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const prisma = await import('@/lib/db/prisma');
    vi.mocked(prisma.prisma.attachment.findFirst).mockResolvedValueOnce({
      id: 'attachment-1',
      messageId: 'message-1',
      originalFilename: 'test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      storageKey: 'attachments/uuid',
      createdAt: new Date(),
      message: {
        id: 'message-1',
        ticketId: 'ticket-1',
        createdById: 'user-123',
        ticket: { workspaceId: 'workspace-1' },
      },
    } as never);

    const downloadStorage: StorageProvider = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(Buffer.from('test content')),
      delete: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
    };

    const service = new AttachmentService(downloadStorage);
    const result = await service.downloadAttachment('attachment-1');

    expect(result.buffer.toString()).toBe('test content');
    expect(result.originalFilename).toBe('test.pdf');
    expect(result.mimeType).toBe('application/pdf');
  });

  it('throws AttachmentNotFoundError for nonexistent attachment', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const prisma = await import('@/lib/db/prisma');
    vi.mocked(prisma.prisma.attachment.findFirst).mockResolvedValueOnce(null as never);

    const service = new AttachmentService(storage);
    await expect(service.downloadAttachment('nonexistent')).rejects.toThrow(AttachmentNotFoundError);
  });
});

describe('AttachmentService.deleteAttachment', () => {
  it('deletes attachment and creates activity record', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const prisma = await import('@/lib/db/prisma');
    vi.mocked(prisma.prisma.attachment.findFirst).mockResolvedValueOnce({
      id: 'attachment-1',
      messageId: 'message-1',
      originalFilename: 'test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      storageKey: 'attachments/uuid',
      createdAt: new Date(),
      message: {
        id: 'message-1',
        ticketId: 'ticket-1',
        createdById: 'user-123',
        ticket: { workspaceId: 'workspace-1' },
      },
    } as never);

    const service = new AttachmentService(storage);
    await expect(service.deleteAttachment('attachment-1')).resolves.toBeUndefined();

    expect(storage.delete).toHaveBeenCalledWith('attachments/uuid');
  });

  it('throws AttachmentNotFoundError for nonexistent attachment', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);

    const prisma = await import('@/lib/db/prisma');
    vi.mocked(prisma.prisma.attachment.findFirst).mockResolvedValueOnce(null as never);

    const service = new AttachmentService(storage);
    await expect(service.deleteAttachment('nonexistent')).rejects.toThrow(AttachmentNotFoundError);
  });
});
