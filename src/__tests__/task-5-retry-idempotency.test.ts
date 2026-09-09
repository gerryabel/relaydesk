import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { recordOutboxFailure, markOutboxEventPermanentlyFailed } from '@/lib/outbox/outbox';

vi.mock('@/lib/email/provider', () => ({
  sendEmail: vi.fn().mockResolvedValue({ status: 'success' }),
  parseEmailProviderConfig: vi.fn().mockReturnValue({ provider: 'console', from: 'test' }),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboxEvent: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    sentEmail: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    ticket: {
      findFirst: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  outboxEvent: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  sentEmail: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  ticket: { findFirst: ReturnType<typeof vi.fn> };
  user: { findFirst: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers().setSystemTime(new Date('2026-09-08T00:00:00Z'));
  mockedPrisma.outboxEvent.findFirst.mockReset();
  mockedPrisma.outboxEvent.updateMany.mockReset();
  mockedPrisma.sentEmail.findUnique.mockReset();
  mockedPrisma.sentEmail.create.mockReset();
  mockedPrisma.ticket.findFirst.mockReset();
  mockedPrisma.user.findFirst.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const baseEvent = {
  id: 'outbox-1',
  eventType: 'TICKET_ASSIGNED' as const,
  aggregateType: 'Ticket' as const,
  aggregateId: 'ticket-1',
  payload: { workspaceId: 'workspace-1', ticketId: 'ticket-1', assigneeId: 'user-1' },
  createdAt: new Date('2026-09-08T00:00:00Z'),
  processedAt: null,
  attempts: 1,
  lastError: null,
};

function createTxClient(overrides: Record<string, unknown> = {}) {
  return {
    outboxEvent: {
      findFirst: mockedPrisma.outboxEvent.findFirst,
      updateMany: mockedPrisma.outboxEvent.updateMany,
    },
    sentEmail: mockedPrisma.sentEmail,
    ...overrides,
  } as never;
}

describe('outbox failure state', () => {
  it('records retryable failure without finalizing', async () => {
    mockedPrisma.outboxEvent.findFirst.mockResolvedValueOnce(baseEvent as never);
    mockedPrisma.outboxEvent.updateMany.mockResolvedValueOnce({ count: 1 } as never);

    const tx = createTxClient();
    await recordOutboxFailure(tx, 'outbox-1', new Error('timeout'));

    expect(mockedPrisma.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { processedAt: null, attempts: { increment: 1 }, lastError: 'timeout' },
    });
  });

  it('marks permanent failure state', async () => {
    mockedPrisma.outboxEvent.updateMany.mockResolvedValueOnce({ count: 1 } as never);

    const tx = createTxClient();
    await markOutboxEventPermanentlyFailed(tx, 'outbox-1', new Error('invalid recipient'));

    expect(mockedPrisma.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'outbox-1', attempts: { lt: 3 } },
      data: {
        processedAt: new Date(Date.now() - 1000),
        lastError: '[task-5:permanent-failure] invalid recipient',
      },
    });
  });
});

describe('email idempotency', () => {
  it('does not call provider when sent email record exists', async () => {
    mockedPrisma.sentEmail.findUnique.mockResolvedValueOnce({ outboxEventId: 'outbox-1', recipient: 'user@example.com', sentAt: new Date() } as never);
    mockedPrisma.ticket.findFirst.mockResolvedValueOnce({ id: 'ticket-1', title: 'Ticket' } as never);
    mockedPrisma.user.findFirst.mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com', name: 'User' } as never);

    const { sendEmailForOutboxEvent } = await import('@/lib/queue/handlers/email-handler');
    const result = await sendEmailForOutboxEvent(baseEvent as never);

    expect(result.status).toBe('success');
    expect(mockedPrisma.sentEmail.create).not.toHaveBeenCalled();
  });

  it('creates sent email record on successful delivery', async () => {
    mockedPrisma.sentEmail.findUnique.mockResolvedValueOnce(null as never);
    mockedPrisma.sentEmail.create.mockResolvedValueOnce({ outboxEventId: 'outbox-1', recipient: 'user@example.com', sentAt: new Date() } as never);
    mockedPrisma.ticket.findFirst.mockResolvedValueOnce({ id: 'ticket-1', title: 'Ticket' } as never);
    mockedPrisma.user.findFirst.mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com', name: 'User' } as never);

    const { sendEmailForOutboxEvent } = await import('@/lib/queue/handlers/email-handler');

    const result = await sendEmailForOutboxEvent(baseEvent as never);

    expect(result.status).toBe('success');
    expect(mockedPrisma.sentEmail.create).toHaveBeenCalledWith({
      data: { outboxEventId: 'outbox-1', recipient: 'user@example.com' },
    });
  });
});

describe('error classification', () => {
  it('wraps retryable delivery result as retryable error', async () => {
    const { classifyDeliveryResult } = await import('@/lib/queue/errors');
    const error = classifyDeliveryResult({
      status: 'retryable_failure',
      error: { code: 'RETRYABLE_FAILURE', message: 'timeout', retryable: true },
    });

    expect(error.message).toContain('timeout');
    expect((error as Error & { retryable?: boolean }).retryable).toBe(true);
  });

  it('wraps permanent delivery result as permanent error', async () => {
    const { classifyDeliveryResult } = await import('@/lib/queue/errors');
    const error = classifyDeliveryResult({
      status: 'permanent_failure',
      error: { code: 'INVALID_RECIPIENT', message: 'bad recipient', retryable: false },
    });

    expect(error.message).toContain('bad recipient');
    expect((error as Error & { retryable?: boolean }).retryable).toBe(false);
  });
});
