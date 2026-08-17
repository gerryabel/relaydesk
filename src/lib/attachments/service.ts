import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import { randomUUID } from 'node:crypto';
import { uploadAttachmentSchema } from './schema';
import { attachmentConfig } from './config';
import { getStorageProvider } from './local-storage';
import type { StorageProvider } from './storage.interface';
import type { UploadAttachmentInput } from './schema';
import { TicketActivityType } from '@/generated/prisma';

export class AttachmentNotFoundError extends Error {
  constructor(message = 'Lampiran tidak ditemukan.') {
    super(message);
    this.name = 'AttachmentNotFoundError';
  }
}

export class MessageNotFoundError extends Error {
  constructor(message = 'Pesan tidak ditemukan.') {
    super(message);
    this.name = 'MessageNotFoundError';
  }
}

export class AttachmentValidationError extends Error {
  constructor(message = 'Validasi lampiran gagal.') {
    super(message);
    this.name = 'AttachmentValidationError';
  }
}

export class StorageError extends Error {
  constructor(message = 'Operasi penyimpanan gagal.') {
    super(message);
    this.name = 'StorageError';
  }
}

export type AttachmentWithMessage = {
  id: string;
  messageId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: Date;
  message: {
    id: string;
    ticketId: string;
    createdById: string | null;
  };
};

export type SafeAttachment = {
  id: string;
  messageId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
};

function generateStorageKey(): string {
  return `attachments/${randomUUID()}`;
}

export class AttachmentService {
  constructor(
    private readonly storage: StorageProvider = getStorageProvider(),
  ) {}

  async uploadAttachment(
    messageId: string,
    input: UploadAttachmentInput,
    fileBuffer: Buffer,
  ): Promise<SafeAttachment> {
    const parsed = uploadAttachmentSchema.parse(input);

    if (fileBuffer.length === 0) {
      throw new AttachmentValidationError('File tidak boleh kosong');
    }

    if (parsed.sizeBytes > attachmentConfig.maxFileSizeBytes) {
      throw new AttachmentValidationError('Ukuran file melebihi batas maksimal');
    }

    if (!attachmentConfig.allowedMimeTypes.includes(parsed.mimeType as (typeof attachmentConfig.allowedMimeTypes)[number])) {
      throw new AttachmentValidationError('Tipe file tidak diizinkan');
    }

    const membership = await getCurrentMembership();

    const message = await prisma.message.findFirst({
      where: { id: messageId },
      include: {
        ticket: {
          select: { workspaceId: true },
        },
      },
    });

    if (!message) {
      throw new MessageNotFoundError();
    }

    if (message.ticket.workspaceId !== membership.workspaceId) {
      throw new MessageNotFoundError();
    }

    const storageKey = generateStorageKey();

    try {
      await this.storage.put(storageKey, fileBuffer);
    } catch (error) {
      throw new StorageError(`Gagal menyimpan file: ${error instanceof Error ? error.message : 'unknown'}`);
    }

    try {
      const attachment = await prisma.$transaction(async (tx) => {
        const created = await tx.attachment.create({
          data: {
            messageId,
            originalFilename: parsed.filename,
            mimeType: parsed.mimeType,
            sizeBytes: parsed.sizeBytes,
            storageKey,
          },
          select: {
            id: true,
            messageId: true,
            originalFilename: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        });

        await tx.ticketActivity.create({
          data: {
            ticketId: message.ticketId,
            actorId: membership.userId,
            type: TicketActivityType.ATTACHMENT_ADDED,
            metadata: { attachmentId: created.id, filename: parsed.filename },
          },
        });

        return created;
      });

      return attachment;
    } catch (error) {
      await this.cleanupStorage(storageKey);
      throw error;
    }
  }

  async getAttachmentsByMessage(messageId: string): Promise<SafeAttachment[]> {
    const membership = await getCurrentMembership();

    const message = await prisma.message.findFirst({
      where: { id: messageId },
      include: {
        ticket: {
          select: { workspaceId: true },
        },
      },
    });

    if (!message) {
      throw new MessageNotFoundError();
    }

    if (message.ticket.workspaceId !== membership.workspaceId) {
      throw new MessageNotFoundError();
    }

    const attachments = await prisma.attachment.findMany({
      where: { messageId },
      select: {
        id: true,
        messageId: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return attachments;
  }

  async getAttachmentById(attachmentId: string): Promise<AttachmentWithMessage> {
    const membership = await getCurrentMembership();

    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId },
      include: {
        message: {
          select: {
            id: true,
            ticketId: true,
            createdById: true,
            ticket: {
              select: { workspaceId: true },
            },
          },
        },
      },
    });

    if (!attachment) {
      throw new AttachmentNotFoundError();
    }

    if (attachment.message.ticket.workspaceId !== membership.workspaceId) {
      throw new AttachmentNotFoundError();
    }

    return {
      id: attachment.id,
      messageId: attachment.messageId,
      originalFilename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      storageKey: attachment.storageKey,
      createdAt: attachment.createdAt,
      message: {
        id: attachment.message.id,
        ticketId: attachment.message.ticketId,
        createdById: attachment.message.createdById,
      },
    };
  }

  async downloadAttachment(attachmentId: string): Promise<{
    buffer: Buffer;
    originalFilename: string;
    mimeType: string;
  }> {
    const attachment = await this.getAttachmentById(attachmentId);

    const buffer = await this.storage.get(attachment.storageKey);

    return {
      buffer,
      originalFilename: attachment.originalFilename,
      mimeType: attachment.mimeType,
    };
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    const membership = await getCurrentMembership();

    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId },
      include: {
        message: {
          select: {
            id: true,
            ticketId: true,
            ticket: {
              select: { workspaceId: true },
            },
          },
        },
      },
    });

    if (!attachment) {
      throw new AttachmentNotFoundError();
    }

    if (attachment.message.ticket.workspaceId !== membership.workspaceId) {
      throw new AttachmentNotFoundError();
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.attachment.delete({
          where: { id: attachmentId },
        });

        await tx.ticketActivity.create({
          data: {
            ticketId: attachment.message.ticketId,
            actorId: membership.userId,
            type: TicketActivityType.ATTACHMENT_REMOVED,
            metadata: { attachmentId, filename: attachment.originalFilename },
          },
        });
      });

      await this.cleanupStorage(attachment.storageKey);
    } catch (error) {
      throw new StorageError(`Gagal menghapus lampiran: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  private async cleanupStorage(storageKey: string): Promise<void> {
    try {
      if (await this.storage.exists(storageKey)) {
        await this.storage.delete(storageKey);
      }
    } catch (error) {
      console.error(`Storage cleanup failed for key ${storageKey}:`, error);
    }
  }
}

export const attachmentService = new AttachmentService();
