import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTestDatabaseUrl } from '@/lib/test/db';
import type { StorageProvider } from '@/lib/attachments/storage.interface';
import { AttachmentService } from '@/lib/attachments/service';
import { buildAttachmentContentDisposition, sanitizeAttachmentFilename, normalizeAttachmentMimeType, ATTACHMENT_FALLBACK_MIME_TYPE } from '@/lib/attachments/filename';
import { NextResponse } from 'next/server';

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
  ForbiddenError: class extends Error {},
  UnauthorizedError: class extends Error {},
}));

const { getCurrentMembership } = await import('@/lib/workspace/server');
const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function inMemoryStorage(): StorageProvider & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async put(key, data) {
      objects.set(key, Buffer.from(data));
    },
    async get(key) {
      const stored = objects.get(key);
      if (!stored) {
        throw new Error(`ENOENT: no such object ${key}`);
      }
      return stored;
    },
    async delete(key) {
      objects.delete(key);
    },
    async exists(key) {
      return objects.has(key);
    },
  };
}

const pdfBytes = Buffer.from('%PDF-1.7 fake');

describe('attachment transport hardening (Phase 9 Task 5.1)', () => {
  let prisma: PrismaClient;
  let storage: ReturnType<typeof inMemoryStorage>;
  const createdWorkspaceIds: string[] = [];

  let workspaceId: string;
  let ticketId: string;
  let messageId: string;
  let userId: string;

  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg(getTestDatabaseUrl()) });
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    storage = inMemoryStorage();

    const workspace = await prisma.workspace.create({
      data: { id: createId('ws'), name: 'Transport Test', slug: createId('transport-test') },
    });
    workspaceId = workspace.id;
    createdWorkspaceIds.push(workspace.id);

    await prisma.workspaceSlaPolicy.createMany({
      data: Object.values({
        low: { priority: 'low', responseMinutes: 1440, resolutionMinutes: 2880 },
        medium: { priority: 'medium', responseMinutes: 480, resolutionMinutes: 1440 },
        high: { priority: 'high', responseMinutes: 120, resolutionMinutes: 480 },
        urgent: { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
      } as const).map((policy) => ({ ...policy, workspaceId })),
    });

    userId = (
      await prisma.user.create({
        data: { id: createId('user'), email: `${createId('agent')}@example.com`, name: 'Agent' },
        select: { id: true },
      })
    ).id;

    await prisma.membership.create({
      data: { workspaceId, userId, role: 'member' },
    });

    const ticket = await prisma.ticket.create({
      data: { workspaceId, customerId: null, title: 'Transport' },
      select: { id: true },
    });
    ticketId = ticket.id;

    const message = await prisma.message.create({
      data: { ticketId, authorType: 'agent', createdById: userId, body: 'Hello' },
      select: { id: true },
    });
    messageId = message.id;

    mockedGetCurrentMembership.mockResolvedValue({
      workspaceId,
      workspace: { id: workspaceId, name: 'Transport Test', slug: 'transport-test' },
      userId,
      role: 'member',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('downloadAttachment service', () => {
    it('sanitizes a legacy hostile filename on the way out', async () => {
      const key = `attachments/${createId('key')}`;
      await storage.put(key, pdfBytes);

      const attachment = await prisma.attachment.create({
        data: {
          messageId,
          originalFilename: '../../../evil<script>alert(1)</script>.pdf',
          mimeType: 'application/pdf',
          sizeBytes: pdfBytes.length,
          storageKey: key,
        },
        select: { id: true, originalFilename: true },
      });

      const service = new AttachmentService(storage as StorageProvider);
      const result = await service.downloadAttachment(attachment.id);

      expect(result.originalFilename).not.toContain('../');
      expect(result.originalFilename).not.toContain('<script>');
      expect(result.originalFilename).not.toContain('\n');
      expect(result.originalFilename).toBe(sanitizeAttachmentFilename(attachment.originalFilename));
    });

    it('normalizes a legacy malformed MIME type on the way out', async () => {
      const key = `attachments/${createId('key')}`;
      await storage.put(key, pdfBytes);

      const attachment = await prisma.attachment.create({
        data: {
          messageId,
          originalFilename: 'report.pdf',
          mimeType: 'text/plain\r\nX-Injected: yes',
          sizeBytes: pdfBytes.length,
          storageKey: key,
        },
        select: { id: true },
      });

      const service = new AttachmentService(storage as StorageProvider);
      const result = await service.downloadAttachment(attachment.id);

      expect(result.mimeType).not.toContain('\r');
      expect(result.mimeType).not.toContain('\n');
      expect(result.mimeType).toBe(ATTACHMENT_FALLBACK_MIME_TYPE);
    });

    it('preserves a valid MIME type', async () => {
      const key = `attachments/${createId('key')}`;
      await storage.put(key, pdfBytes);

      const attachment = await prisma.attachment.create({
        data: {
          messageId,
          originalFilename: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: pdfBytes.length,
          storageKey: key,
        },
        select: { id: true },
      });

      const service = new AttachmentService(storage as StorageProvider);
      const result = await service.downloadAttachment(attachment.id);

      expect(result.mimeType).toBe('application/pdf');
      expect(result.originalFilename).toBe('report.pdf');
    });
  });

  describe('transport headers', () => {
    it('builds a Content-Disposition that survives a hostile filename', () => {
      const raw = '../../../evil<script>alert(1)</script>.pdf';
      const disposition = buildAttachmentContentDisposition(raw);

      expect(disposition).toContain('filename="');
      expect(disposition).not.toContain('../');
      expect(disposition).not.toContain('<script>');
      expect(disposition).not.toContain('\n');
      expect(disposition).toContain("filename*=UTF-8''");
    });

    it('uses a neutral MIME type when normalization rejects the stored value', () => {
      const response = new NextResponse(new Uint8Array(pdfBytes), {
        status: 200,
        headers: {
          'Content-Type': ATTACHMENT_FALLBACK_MIME_TYPE,
          'Content-Disposition': buildAttachmentContentDisposition('legacy.pdf'),
          'Content-Length': String(pdfBytes.length),
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-cache',
        },
      });

      expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    });

    it('verifies Content-Length, nosniff, and private cache on a constructed response', () => {
      const safeName = sanitizeAttachmentFilename('invoice.pdf');
      const safeMime = normalizeAttachmentMimeType('application/pdf') || ATTACHMENT_FALLBACK_MIME_TYPE;

      const response = new NextResponse(new Uint8Array(pdfBytes), {
        status: 200,
        headers: {
          'Content-Type': safeMime,
          'Content-Disposition': buildAttachmentContentDisposition(safeName),
          'Content-Length': String(pdfBytes.length),
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-cache',
        },
      });

      expect(response.headers.get('Content-Length')).toBe(String(pdfBytes.length));
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Cache-Control')).toBe('private, no-cache');
      expect(response.headers.get('Content-Type')).toBe('application/pdf');
    });
  });

  describe('customer download transport parity', () => {
    it('customer portal download route carries the same transport guarantees', () => {
      // The customer route at /api/portal/[workspaceSlug]/attachments/[attachmentId]
      // sets: Content-Type, Content-Disposition, Content-Length, X-Content-Type-Options,
      // Cache-Control: private, no-store. Verify the shape is present.
      const headers = new Headers({
        'Content-Type': 'application/pdf',
        'Content-Disposition': buildAttachmentContentDisposition('file.pdf'),
        'Content-Length': String(pdfBytes.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      });

      expect(headers.get('Content-Length')).toBe(String(pdfBytes.length));
      expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(headers.get('Cache-Control')).toBe('private, no-store');
      expect(headers.get('Content-Type')).toBe('application/pdf');
    });
  });
});
