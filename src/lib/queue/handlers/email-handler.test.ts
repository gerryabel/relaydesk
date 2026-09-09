import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleEmailOutboxEvent, SENDING_STATUS, SENT_STATUS } from '@/lib/queue/handlers/email-handler';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/email/provider';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    ticket: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    sentEmail: {
      findFirst: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

vi.mock('@/lib/email/provider', () => ({
  sendEmail: vi.fn(),
  parseEmailProviderConfig: vi.fn().mockReturnValue({ provider: 'console', from: 'test' }),
}));

const fakeOutboxEvent = {
  id: 'outbox-email-1',
  eventType: 'TICKET_ASSIGNED' as const,
  aggregateType: 'Ticket' as const,
  aggregateId: 'ticket-1',
  payload: {
    workspaceId: 'workspace-123',
    ticketId: 'ticket-1',
    assigneeId: 'user-456',
    previousAssigneeId: null,
    actorId: 'user-123',
  },
  createdAt: new Date('2026-09-08T00:00:00Z'),
  processedAt: null,
  attempts: 1,
  lastError: null,
};

const mockedPrisma = prisma as unknown as {
  ticket: { findFirst: ReturnType<typeof vi.fn> };
  user: { findFirst: ReturnType<typeof vi.fn> };
  sentEmail: {
    findFirst: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};
const mockedSendEmail = vi.mocked(sendEmail);

const resetEmailMocks = () => {
  mockedPrisma.ticket.findFirst.mockReset();
  mockedPrisma.user.findFirst.mockReset();
  mockedPrisma.sentEmail.findFirst.mockReset();
  mockedPrisma.sentEmail.deleteMany.mockReset();
  mockedPrisma.sentEmail.create.mockReset();
  mockedPrisma.sentEmail.updateMany.mockReset();
  mockedSendEmail.mockReset();
};

const successProvider = () => mockedSendEmail.mockResolvedValue({ status: 'success' });
const sentRow = (overrides = {}) => ({ outboxEventId: 'outbox-email-1', recipient: 'assignee@example.com', sentAt: new Date(), status: SENT_STATUS, ...overrides });

describe('email handler idempotency', () => {
  beforeEach(() => {
    vi.resetModules();
    resetEmailMocks();
    vi.useFakeTimers().setSystemTime(new Date('2026-09-08T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call provider when sent email record exists', async () => {
    mockedPrisma.ticket.findFirst.mockResolvedValueOnce({ id: 'ticket-1', title: 'Judul Tiket' } as never);
    mockedPrisma.user.findFirst.mockResolvedValueOnce({ id: 'user-456', email: 'assignee@example.com', name: 'Assignee' } as never);
    mockedPrisma.sentEmail.findFirst.mockResolvedValueOnce(sentRow() as never);

    const result = await handleEmailOutboxEvent(fakeOutboxEvent as never);

    expect(result.status).toBe('success');
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedPrisma.sentEmail.create).not.toHaveBeenCalled();
  });

  it('creates sent email record on successful delivery', async () => {
    mockedPrisma.ticket.findFirst.mockResolvedValueOnce({ id: 'ticket-1', title: 'Judul Tiket' } as never);
    mockedPrisma.user.findFirst.mockResolvedValueOnce({ id: 'user-456', email: 'assignee@example.com', name: 'Assignee' } as never);
    mockedPrisma.sentEmail.findFirst.mockResolvedValueOnce(null as never);
    mockedPrisma.sentEmail.create.mockResolvedValueOnce({ outboxEventId: 'outbox-email-1', recipient: 'assignee@example.com', sentAt: new Date() } as never);
    successProvider();

    const result = await handleEmailOutboxEvent(fakeOutboxEvent as never);

    expect(result.status).toBe('success');
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.sentEmail.create).toHaveBeenCalledWith({
      data: { outboxEventId: 'outbox-email-1', recipient: 'assignee@example.com', status: SENDING_STATUS, claimedAt: expect.any(Date) },
    });
    expect(mockedPrisma.sentEmail.updateMany).toHaveBeenCalledWith({
      where: { outboxEventId: 'outbox-email-1', status: SENDING_STATUS },
      data: { status: SENT_STATUS, sentAt: expect.any(Date) },
    });
  });

  it('treats concurrent duplicate claim as success without double sending', async () => {
    const duplicateUniqueError = new Error('duplicate key') as Error & { code?: string };
    duplicateUniqueError.code = 'P2002';

    mockedPrisma.ticket.findFirst.mockResolvedValueOnce({ id: 'ticket-1', title: 'Judul Tiket' } as never);
    mockedPrisma.user.findFirst.mockResolvedValueOnce({ id: 'user-456', email: 'assignee@example.com', name: 'Assignee' } as never);
    mockedPrisma.sentEmail.findFirst.mockResolvedValueOnce(null as never);
    mockedPrisma.sentEmail.create
      .mockRejectedValueOnce(duplicateUniqueError)
      .mockRejectedValueOnce(duplicateUniqueError);

    const firstHandler = handleEmailOutboxEvent(fakeOutboxEvent as never);
    const secondHandler = handleEmailOutboxEvent(fakeOutboxEvent as never);
    const [firstResult, secondResult] = await Promise.all([firstHandler, secondHandler]);

    expect(firstResult.status).toBe('success');
    expect(secondResult.status).toBe('success');
    expect(mockedSendEmail).toHaveBeenCalledTimes(0);
    expect(mockedPrisma.sentEmail.create).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.sentEmail.updateMany).not.toHaveBeenCalled();
  });

  it('recovers from stale sending claim and completes delivery', async () => {
    mockedPrisma.ticket.findFirst.mockResolvedValueOnce({ id: 'ticket-1', title: 'Judul Tiket' } as never);
    mockedPrisma.user.findFirst.mockResolvedValueOnce({ id: 'user-456', email: 'assignee@example.com', name: 'Assignee' } as never);
    mockedPrisma.sentEmail.findFirst.mockResolvedValueOnce(null as never);
    mockedPrisma.sentEmail.deleteMany.mockResolvedValueOnce({ count: 1 } as never);
    mockedPrisma.sentEmail.create.mockResolvedValueOnce({ outboxEventId: 'outbox-email-1', recipient: 'assignee@example.com', sentAt: new Date() } as never);
    successProvider();

    const result = await handleEmailOutboxEvent(fakeOutboxEvent as never);

    expect(result.status).toBe('success');
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.sentEmail.deleteMany).toHaveBeenCalledWith({
      where: { outboxEventId: 'outbox-email-1', status: SENDING_STATUS, claimedAt: { lt: expect.any(Date) } },
    });
    expect(mockedPrisma.sentEmail.create).toHaveBeenCalledWith({
      data: { outboxEventId: 'outbox-email-1', recipient: 'assignee@example.com', status: SENDING_STATUS, claimedAt: expect.any(Date) },
    });
  });

  it('releases claim on retryable provider failure', async () => {
    mockedPrisma.ticket.findFirst.mockResolvedValueOnce({ id: 'ticket-1', title: 'Judul Tiket' } as never);
    mockedPrisma.user.findFirst.mockResolvedValueOnce({ id: 'user-456', email: 'assignee@example.com', name: 'Assignee' } as never);
    mockedPrisma.sentEmail.findFirst.mockResolvedValueOnce(null as never);
    mockedPrisma.sentEmail.create.mockResolvedValueOnce({ outboxEventId: 'outbox-email-1', recipient: 'assignee@example.com', sentAt: new Date() } as never);
    mockedSendEmail.mockResolvedValueOnce({ status: 'retryable_failure', error: { code: 'RETRYABLE_FAILURE', message: 'timeout', retryable: true } });

    const result = await handleEmailOutboxEvent(fakeOutboxEvent as never);

    expect(result.status).toBe('failure');
    expect((result as { error?: { retryable?: boolean } }).error?.retryable).toBe(true);
    expect(mockedPrisma.sentEmail.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.sentEmail.deleteMany).toHaveBeenCalledWith({
      where: { outboxEventId: 'outbox-email-1', status: SENDING_STATUS },
    });
  });

  it('returns permanent failure for invalid provider response', async () => {
    mockedPrisma.ticket.findFirst.mockResolvedValueOnce({ id: 'ticket-1', title: 'Judul Tiket' } as never);
    mockedPrisma.user.findFirst.mockResolvedValueOnce({ id: 'user-456', email: 'assignee@example.com', name: 'Assignee' } as never);
    mockedPrisma.sentEmail.findFirst.mockResolvedValueOnce(null as never);
    mockedPrisma.sentEmail.create.mockResolvedValueOnce({ outboxEventId: 'outbox-email-1', recipient: 'assignee@example.com', sentAt: new Date() } as never);
    mockedSendEmail.mockResolvedValueOnce({ status: 'permanent_failure', error: { code: 'INVALID_RECIPIENT', message: 'bad recipient', retryable: false } });

    const result = await handleEmailOutboxEvent(fakeOutboxEvent as never);

    expect(result.status).toBe('failure');
    expect((result as { error?: { retryable?: boolean } }).error?.retryable).toBe(false);
    expect(mockedPrisma.sentEmail.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.sentEmail.updateMany).not.toHaveBeenCalled();
  });
});
