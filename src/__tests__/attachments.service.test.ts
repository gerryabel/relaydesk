import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttachmentService, MessageNotFoundError, AttachmentValidationError, StorageError, AttachmentNotFoundError } from '@/lib/attachments/service';
import type { StorageProvider } from '@/lib/attachments/storage.interface';
import { getCurrentMembership } from '@/lib/workspace/server';

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
    create: vi.fn().mockResolvedValue({
      id: 'attachment-1',
      messageId: 'message-1',
      originalFilename: 'test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      createdAt: new Date(),
    }),
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue({}),
  };

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
