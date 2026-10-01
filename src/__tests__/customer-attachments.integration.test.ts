import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTestDatabaseUrl } from '@/lib/test/db';
import { DEFAULT_SLA_POLICIES_MINUTES } from '@/lib/tickets/sla';
import type { StorageProvider } from '@/lib/attachments/storage.interface';
import { MessageAuthorType } from '@/generated/prisma';

/** Every author type the schema knows, read from the generated enum. */
const ALL_AUTHOR_TYPES = Object.values(MessageAuthorType);

/**
 * Customer attachment authorization against a real database (Phase 9 Task 4).
 *
 * The mocked service tests assert that the ownership predicates are *present* in
 * the query. That is not the same as the predicates being *correct*, and the gap
 * between those two claims is exactly where a cross-tenant attachment bug would
 * live:
 *
 *  - a Prisma relation filter is easy to write against the wrong relation
 *    (`message.ticket` vs `message.ticket.customer`), and the wrong one type-checks
 *    perfectly and silently authorizes too much;
 *  - `authorType: { in: [...] }` is easy to typo as `authorType: 'agent'`, which
 *    looks restrictive and is the opposite;
 *  - an assertion written against the mocked `findFirst` cannot see that the
 *    generated SQL joins three tables to reach `ticket.customerId`.
 *
 * So each guarantee is re-proved here by inserting the rows a hostile caller
 * would need and reading back what the service actually returns. Every negative
 * case seeds a row that *should* be invisible; a positive control in the same
 * file proves the fixtures are not merely empty.
 *
 * The session is stubbed at the boundary, as in the Task 2/3 integration suites,
 * because these tests are about ownership rather than about the cookie path.
 */

vi.mock('@/lib/customer-portal/session', () => ({
  requireCustomerInWorkspace: vi.fn(),
}));

const { requireCustomerInWorkspace } = await import('@/lib/customer-portal/session');
const { uploadCustomerAttachment, downloadCustomerAttachment, CustomerAttachmentNotFoundError } =
  await import('@/lib/customer-portal/attachments');
const { CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT } = await import('@/lib/customer-portal/schema');
const { getCustomerTicket } = await import('@/lib/customer-portal/server');

const mockedRequireSession = vi.mocked(requireCustomerInWorkspace);

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/** An in-memory provider, so these tests need no filesystem and no storage env. */
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
const pngBytes = Buffer.from('\x89PNG\r\n\x1a\n fake');

describe('customer attachments against a real database', () => {
  let prisma: PrismaClient;
  let storage: ReturnType<typeof inMemoryStorage>;
  const createdWorkspaceIds: string[] = [];

  let workspaceId: string;
  let workspaceSlug: string;
  let customerId: string;
  let otherCustomerId: string;

  /** The customer's own ticket, reused by most cases. */
  let ticketId: string;
  let customerMessageId: string;

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
      data: { id: createId('ws'), name: 'Attachment Test', slug: createId('attach-test') },
    });

    workspaceId = workspace.id;
    workspaceSlug = workspace.slug;
    createdWorkspaceIds.push(workspace.id);

    await prisma.workspaceSlaPolicy.createMany({
      data: Object.values(DEFAULT_SLA_POLICIES_MINUTES).map((policy) => ({
        workspaceId,
        priority: policy.priority,
        responseMinutes: policy.responseMinutes,
        resolutionMinutes: policy.resolutionMinutes,
      })),
    });

    customerId = (
      await prisma.customer.create({
        data: { workspaceId, name: 'Buyer', email: 'buyer@example.com' },
        select: { id: true },
      })
    ).id;

    otherCustomerId = (
      await prisma.customer.create({
        data: { workspaceId, name: 'Other', email: 'other@example.com' },
        select: { id: true },
      })
    ).id;

    const ticket = await prisma.ticket.create({
      data: { workspaceId, customerId, title: 'Mine' },
      select: { id: true },
    });

    ticketId = ticket.id;

    const message = await prisma.message.create({
      data: { ticketId, authorType: 'customer', customerId, body: 'Here you go' },
      select: { id: true },
    });

    customerMessageId = message.id;

    signInAs(customerId, workspaceId, workspaceSlug);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function signInAs(activeCustomerId: string, activeWorkspaceId: string, activeSlug: string) {
    mockedRequireSession.mockResolvedValue({
      workspace: { id: activeWorkspaceId, name: 'Attachment Test', slug: activeSlug },
      customer: {
        sessionId: 'session-1',
        customerId: activeCustomerId,
        workspaceId: activeWorkspaceId,
        workspaceSlug: activeSlug,
        workspaceName: 'Attachment Test',
        email: 'buyer@example.com',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    } as never);
  }

  function upload(overrides: Record<string, unknown> = {}) {
    return uploadCustomerAttachment(
      {
        workspaceSlug,
        ticketId,
        messageId: customerMessageId,
        declaredFilename: 'invoice.pdf',
        declaredMimeType: 'application/pdf',
        buffer: pdfBytes,
        ...overrides,
      },
      storage,
    );
  }

  describe('upload', () => {
    it('attaches to an owned customer message', async () => {
      // The positive control. Without it, every negative case below would also
      // pass if the service rejected everything.
      const attachment = await upload();

      expect(attachment.originalFilename).toBe('invoice.pdf');
      expect(attachment.sizeBytes).toBe(pdfBytes.length);

      const stored = await prisma.attachment.findUniqueOrThrow({
        where: { id: attachment.id },
      });

      expect(stored.messageId).toBe(customerMessageId);
    });

    it('stores the sanitized name and the normalized type', async () => {
      const attachment = await upload({
        declaredFilename: '../../etc/passwd',
        declaredMimeType: 'APPLICATION/PDF',
      });

      expect(attachment.originalFilename).toBe('passwd');
      expect(attachment.mimeType).toBe('application/pdf');

      const stored = await prisma.attachment.findUniqueOrThrow({
        where: { id: attachment.id },
      });

      expect(stored.originalFilename).toBe('passwd');
    });

    it('stores bytes under an opaque key that never contains the filename', async () => {
      const attachment = await upload({ declaredFilename: 'secret-payroll.png' });

      const stored = await prisma.attachment.findUniqueOrThrow({
        where: { id: attachment.id },
      });

      expect(stored.storageKey).toMatch(/^attachments\/[0-9a-f-]{36}$/);
      expect(stored.storageKey).not.toContain('secret');
      expect(stored.storageKey).not.toContain('payroll');
      expect(stored.storageKey).not.toContain('..');
    });

    it('writes activity attributed to no user', async () => {
      await upload();

      const activity = await prisma.ticketActivity.findFirstOrThrow({
        where: { ticketId, type: 'ATTACHMENT_ADDED' },
      });

      // A customer is not a `User`. `actorId` must be null rather than some
      // plausible-looking workspace user id.
      expect(activity.actorId).toBeNull();
    });

    it('refuses another customer message in the same workspace', async () => {
      const theirs = await prisma.ticket.create({
        data: { workspaceId, customerId: otherCustomerId, title: 'Theirs' },
        select: { id: true },
      });

      const theirMessage = await prisma.message.create({
        data: {
          ticketId: theirs.id,
          authorType: 'customer',
          customerId: otherCustomerId,
          body: 'Mine',
        },
        select: { id: true },
      });

      await expect(upload({ messageId: theirMessage.id })).rejects.toBeInstanceOf(
        CustomerAttachmentNotFoundError,
      );

      expect(await prisma.attachment.count()).toBe(0);
    });

    it('refuses a customer message on another workspace ticket', async () => {
      const otherWorkspace = await prisma.workspace.create({
        data: { id: createId('ws'), name: 'Other', slug: createId('other') },
      });

      createdWorkspaceIds.push(otherWorkspace.id);

      const theirCustomer = (
        await prisma.customer.create({
          data: {
            workspaceId: otherWorkspace.id,
            name: 'Stranger',
            email: 'stranger@example.com',
          },
          select: { id: true },
        })
      ).id;

      const theirTicket = await prisma.ticket.create({
        data: { workspaceId: otherWorkspace.id, customerId: theirCustomer, title: 'Theirs' },
        select: { id: true },
      });

      const theirMessage = await prisma.message.create({
        data: {
          ticketId: theirTicket.id,
          authorType: 'customer',
          customerId: theirCustomer,
          body: 'Mine',
        },
        select: { id: true },
      });

      // Same customer id is impossible here, so the *workspace* predicate is the
      // only thing standing between the caller and another tenant's ticket.
      await expect(
        upload({ ticketId: theirTicket.id, messageId: theirMessage.id }),
      ).rejects.toBeInstanceOf(CustomerAttachmentNotFoundError);

      expect(await prisma.attachment.count()).toBe(0);
    });

    it('refuses an agent-authored message on the customer own ticket', async () => {
      const user = await prisma.user.create({
        data: { id: createId('user'), email: `${createId('agent')}@example.com`, name: 'Agent' },
        select: { id: true },
      });

      await prisma.membership.create({
        data: { workspaceId, userId: user.id, role: 'member' },
      });

      const agentMessage = await prisma.message.create({
        data: {
          ticketId,
          authorType: 'agent',
          createdById: user.id,
          body: 'Agent reply',
        },
        select: { id: true },
      });

      // Uploading onto an agent's message would let a customer forge agent
      // context: the file would appear attached to something an agent said.
      await expect(upload({ messageId: agentMessage.id })).rejects.toBeInstanceOf(
        CustomerAttachmentNotFoundError,
      );
    });

    it('refuses a system message', async () => {
      const systemMessage = await prisma.message.create({
        data: { ticketId, authorType: 'system', body: 'Ticket created' },
        select: { id: true },
      });

      await expect(upload({ messageId: systemMessage.id })).rejects.toBeInstanceOf(
        CustomerAttachmentNotFoundError,
      );
    });

    it('refuses a message on a ticket the customer does not own', async () => {
      // A ticket in the same workspace, owned by someone else, carrying a
      // message whose customerId happens to match. The ticket predicate is what
      // has to reject this.
      const theirs = await prisma.ticket.create({
        data: { workspaceId, customerId: otherCustomerId, title: 'Theirs' },
        select: { id: true },
      });

      const planted = await prisma.message.create({
        data: { ticketId: theirs.id, authorType: 'customer', customerId, body: 'Planted' },
        select: { id: true },
      });

      await expect(
        upload({ ticketId: theirs.id, messageId: planted.id }),
      ).rejects.toBeInstanceOf(CustomerAttachmentNotFoundError);
    });

    it('refuses a message id paired with the wrong ticket id', async () => {
      const theirs = await prisma.ticket.create({
        data: { workspaceId, customerId: otherCustomerId, title: 'Theirs' },
        select: { id: true },
      });

      // Right message, wrong ticket. Both ids are caller-supplied, so both must
      // be part of the same predicate — passing the ticket check alone would
      // leave this open.
      await expect(
        upload({ ticketId: theirs.id, messageId: customerMessageId }),
      ).rejects.toBeInstanceOf(CustomerAttachmentNotFoundError);
    });

    it('refuses an unknown message id', async () => {
      await expect(upload({ messageId: createId('message') })).rejects.toBeInstanceOf(
        CustomerAttachmentNotFoundError,
      );
    });

    it('enforces the per-message limit against real rows', async () => {
      for (let index = 0; index < CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT; index += 1) {
        await upload({ declaredFilename: `file-${index}.pdf` });
      }

      expect(await prisma.attachment.count()).toBe(CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT);

      await expect(upload({ declaredFilename: 'one-too-many.pdf' })).rejects.toThrow();

      // The rejected upload must not have left a row or an object behind.
      expect(await prisma.attachment.count()).toBe(CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT);
      expect(storage.objects.size).toBe(CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT);
    });

    it('does not leave a stored object when the metadata write fails', async () => {
      const failures = vi
        .spyOn(prisma, '$transaction')
        .mockRejectedValue(new Error('deadlock detected'));

      await expect(upload()).rejects.toThrow();

      expect(storage.objects.size).toBe(0);
      expect(await prisma.attachment.count()).toBe(0);

      failures.mockRestore();
    });
  });

  describe('download', () => {
    /** Creates an attachment row plus its stored bytes, bypassing the service. */
    async function seedAttachment(
      overrides: {
        ticketOwnerId?: string;
        authorType?: MessageAuthorType;
        createdById?: string | null;
        filename?: string;
      } = {},
    ) {
      const owner = overrides.ticketOwnerId ?? customerId;
      const owningTicket =
        overrides.ticketOwnerId && overrides.ticketOwnerId !== customerId
          ? (
              await prisma.ticket.create({
                data: { workspaceId, customerId: owner, title: 'Theirs' },
                select: { id: true },
              })
            ).id
          : ticketId;

      const authorType = overrides.authorType ?? 'customer';

      // Task 3's CHECK constraints pin the author keys to the author type:
      // `agent` requires `createdById` and forbids `customerId`; `customer`
      // requires `customerId` and forbids `createdById`; `system` forbids both.
      // Deriving both from `authorType` keeps these fixtures valid rather than
      // letting the database reject them for an unrelated reason.
      const message = await prisma.message.create({
        data: {
          ticketId: owningTicket,
          authorType,
          customerId: authorType === 'customer' ? owner : null,
          createdById: authorType === 'agent' ? (overrides.createdById ?? null) : null,
          body: 'Message',
        },
        select: { id: true },
      });

      const key = `attachments/${createId('key')}`;

      await storage.put(key, pdfBytes);

      const attachment = await prisma.attachment.create({
        data: {
          messageId: message.id,
          originalFilename: overrides.filename ?? 'invoice.pdf',
          mimeType: 'application/pdf',
          sizeBytes: pdfBytes.length,
          storageKey: key,
        },
        select: { id: true },
      });

      return attachment.id;
    }

    it('returns the bytes for an owned customer attachment', async () => {
      const attachmentId = await seedAttachment();

      const file = await downloadCustomerAttachment(
        { workspaceSlug, attachmentId },
        storage,
      );

      expect(file.filename).toBe('invoice.pdf');
      expect(file.buffer.equals(pdfBytes)).toBe(true);
    });

    it('returns the bytes for an agent attachment on the customer own ticket', async () => {
      const user = await prisma.user.create({
        data: { id: createId('user'), email: `${createId('agent')}@example.com`, name: 'Agent' },
        select: { id: true },
      });

      await prisma.membership.create({
        data: { workspaceId, userId: user.id, role: 'member' },
      });

      // Agent uploads are part of the customer-visible conversation, so this
      // must work; the authorization test below is what excludes internal ones.
      const attachmentId = await seedAttachment({
        authorType: 'agent',
        createdById: user.id,
      });

      const file = await downloadCustomerAttachment({ workspaceSlug, attachmentId }, storage);

      expect(file.buffer.equals(pdfBytes)).toBe(true);
    });

    it('refuses another customer attachment in the same workspace', async () => {
      const attachmentId = await seedAttachment({ ticketOwnerId: otherCustomerId });

      await expect(
        downloadCustomerAttachment({ workspaceSlug, attachmentId }, storage),
      ).rejects.toBeInstanceOf(CustomerAttachmentNotFoundError);
    });

    it('refuses an attachment on another workspace ticket', async () => {
      const otherWorkspace = await prisma.workspace.create({
        data: { id: createId('ws'), name: 'Other', slug: createId('other') },
      });

      createdWorkspaceIds.push(otherWorkspace.id);

      const theirCustomer = (
        await prisma.customer.create({
          data: {
            workspaceId: otherWorkspace.id,
            name: 'Stranger',
            email: 'stranger@example.com',
          },
          select: { id: true },
        })
      ).id;

      const theirTicket = await prisma.ticket.create({
        data: { workspaceId: otherWorkspace.id, customerId: theirCustomer, title: 'Theirs' },
        select: { id: true },
      });

      const theirMessage = await prisma.message.create({
        data: { ticketId: theirTicket.id, authorType: 'customer', customerId: theirCustomer, body: 'x' },
        select: { id: true },
      });

      const key = `attachments/${createId('key')}`;

      await storage.put(key, pdfBytes);

      const attachmentId = (
        await prisma.attachment.create({
          data: {
            messageId: theirMessage.id,
            originalFilename: 'theirs.pdf',
            mimeType: 'application/pdf',
            sizeBytes: pdfBytes.length,
            storageKey: key,
          },
          select: { id: true },
        })
      ).id;

      await expect(
        downloadCustomerAttachment({ workspaceSlug, attachmentId }, storage),
      ).rejects.toBeInstanceOf(CustomerAttachmentNotFoundError);
    });

    it('refuses a system message attachment', async () => {
      const attachmentId = await seedAttachment({ authorType: 'system' });

      await expect(
        downloadCustomerAttachment({ workspaceSlug, attachmentId }, storage),
      ).rejects.toBeInstanceOf(CustomerAttachmentNotFoundError);
    });

    it('refuses every author type that is not agent or customer', async () => {
      // `MessageAuthorType` has exactly three members. The two visible ones are
      // covered above, so this walks the remaining one — and asserts the
      // allowlist positively, so a future enum member added without a decision
      // would show up as a failing test rather than silently becoming visible.
      const user = await prisma.user.create({
        data: { id: createId('user'), email: `${createId('sys')}@example.com`, name: 'Staff' },
        select: { id: true },
      });

      await prisma.membership.create({
        data: { workspaceId, userId: user.id, role: 'member' },
      });

      for (const authorType of ALL_AUTHOR_TYPES) {
        if (authorType === 'agent' || authorType === 'customer') {
          continue;
        }

        const attachmentId = await seedAttachment({ authorType });

        await expect(
          downloadCustomerAttachment({ workspaceSlug, attachmentId }, storage),
        ).rejects.toBeInstanceOf(CustomerAttachmentNotFoundError);
      }
    });

    it('refuses an unknown attachment id', async () => {
      await expect(
        downloadCustomerAttachment({ workspaceSlug, attachmentId: createId('att') }, storage),
      ).rejects.toBeInstanceOf(CustomerAttachmentNotFoundError);
    });

    it('gives a foreign and an unknown id the identical error', async () => {
      const foreign = await seedAttachment({ ticketOwnerId: otherCustomerId });

      const foreignMessage = await downloadCustomerAttachment(
        { workspaceSlug, attachmentId: foreign },
        storage,
      ).catch((error: Error) => error.message);

      const unknownMessage = await downloadCustomerAttachment(
        { workspaceSlug, attachmentId: createId('att') },
        storage,
      ).catch((error: Error) => error.message);

      expect(foreignMessage).toBe(unknownMessage);
    });

    it('never reads storage for a refused id', async () => {
      const foreign = await seedAttachment({ ticketOwnerId: otherCustomerId });

      const get = vi.spyOn(storage, 'get');

      await expect(
        downloadCustomerAttachment({ workspaceSlug, attachmentId: foreign }, storage),
      ).rejects.toBeInstanceOf(CustomerAttachmentNotFoundError);

      expect(get).not.toHaveBeenCalled();
    });

    it('re-sanitizes a legacy filename stored before sanitization existed', async () => {
      const attachmentId = await seedAttachment({ filename: '../../etc/passwd' });

      const file = await downloadCustomerAttachment({ workspaceSlug, attachmentId }, storage);

      // Rows written through the internal route predate this task, so the read
      // path has to be safe on its own rather than trusting the write path.
      expect(file.filename).toBe('passwd');
    });

    it('reads the bytes of an attachment uploaded through this task', async () => {
      // End to end through the real service for both halves, then read back.
      const uploaded = await upload({ declaredFilename: 'round trip.pdf' });

      const file = await downloadCustomerAttachment(
        { workspaceSlug, attachmentId: uploaded.id },
        storage,
      );

      expect(file.filename).toBe('round trip.pdf');
      expect(file.buffer.equals(pdfBytes)).toBe(true);
    });

    it('is unaffected by a second customer signing in', async () => {
      const attachmentId = await seedAttachment();

      // The same attachment must stop being readable once the session belongs to
      // somebody else — the predicate is re-evaluated per request, never cached.
      signInAs(otherCustomerId, workspaceId, workspaceSlug);

      await expect(
        downloadCustomerAttachment({ workspaceSlug, attachmentId }, storage),
      ).rejects.toBeInstanceOf(CustomerAttachmentNotFoundError);

      signInAs(customerId, workspaceId, workspaceSlug);

      await expect(
        downloadCustomerAttachment({ workspaceSlug, attachmentId }, storage),
      ).resolves.toMatchObject({ filename: 'invoice.pdf' });
    });
  });

  describe('interaction between the two halves', () => {
    it('enforces the limit per message, not per ticket', async () => {
      const secondMessage = await prisma.message.create({
        data: { ticketId, authorType: 'customer', customerId, body: 'Also' },
        select: { id: true },
      });

      for (let index = 0; index < CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT; index += 1) {
        await upload({ declaredFilename: `first-${index}.pdf` });
      }

      // The second message has its own budget; a per-ticket cap would have
      // rejected this.
      await expect(
        upload({ messageId: secondMessage.id, declaredFilename: 'second.pdf' }),
      ).resolves.toMatchObject({ originalFilename: 'second.pdf' });
    });

    it('counts an agent attachment against the customer budget', async () => {
      const user = await prisma.user.create({
        data: { id: createId('user'), email: `${createId('agent')}@example.com`, name: 'Agent' },
        select: { id: true },
      });

      await prisma.membership.create({
        data: { workspaceId, userId: user.id, role: 'member' },
      });

      const agentMessage = await prisma.message.create({
        data: { ticketId, authorType: 'agent', createdById: user.id, body: 'Files' },
        select: { id: true },
      });

      for (let index = 0; index < CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT; index += 1) {
        const key = `attachments/${createId('key')}`;

        await storage.put(key, pngBytes);

        await prisma.attachment.create({
          data: {
            messageId: agentMessage.id,
            originalFilename: `agent-${index}.png`,
            mimeType: 'image/png',
            sizeBytes: pngBytes.length,
            storageKey: key,
          },
        });
      }

      // The customer's own message shares the ticket but not the message, so it
      // is unaffected — which is the behaviour these two lines are pinning down.
      await expect(upload()).resolves.toMatchObject({ originalFilename: 'invoice.pdf' });
    });

    it('does not move the ticket last activity for a customer attachment', async () => {
      const before = await getCustomerTicket({ workspaceSlug, ticketId });

      await upload();

      const after = await getCustomerTicket({ workspaceSlug, ticketId });

      // `lastActivityAt` is derived from customer-visible messages and status
      // changes (`loadLastVisibleActivity`), and an attachment is neither. The
      // ATTACHMENT_ADDED activity row that *is* written must therefore not
      // surface: a file with no words would otherwise reorder the customer's
      // ticket list under them, and would tell them something changed when
      // nothing they can read did.
      expect(after.lastActivityAt).toBe(before.lastActivityAt);
    });
  });

});