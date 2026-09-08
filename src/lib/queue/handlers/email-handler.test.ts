import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEmailOutboxEvent } from '@/lib/queue/handlers/email-handler';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/email/provider';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    ticket: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/email/provider', () => ({
  sendEmail: vi.fn(),
}));

const mockedTicketFindFirst = vi.mocked(prisma.ticket.findFirst);
const mockedUserFindFirst = vi.mocked(prisma.user.findFirst);
const mockedSendEmail = vi.mocked(sendEmail);

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

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});

describe('email handler', () => {
  it('sends email for valid ticket assigned event', async () => {
    mockedTicketFindFirst.mockResolvedValueOnce({ id: 'ticket-1', title: 'Judul Tiket' } as never);
    mockedUserFindFirst.mockResolvedValueOnce({ id: 'user-456', email: 'assignee@example.com', name: 'Assignee' } as never);
    mockedSendEmail.mockResolvedValueOnce({ status: 'success' });

    const result = await handleEmailOutboxEvent(fakeOutboxEvent as never);

    expect(result.status).toBe('success');
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
  });

  it('returns permanent failure when assignee email is missing', async () => {
    mockedTicketFindFirst.mockResolvedValueOnce({ id: 'ticket-1', title: 'Judul Tiket' } as never);
    mockedUserFindFirst.mockResolvedValueOnce({ id: 'user-456', email: null, name: 'Assignee' } as never);

    const result = await handleEmailOutboxEvent(fakeOutboxEvent as never);

    expect(result.status).toBe('failure');
    expect((result as { error?: { message?: string } }).error?.message).toContain('does not have an email');
  });

  it('returns permanent failure for unsupported event type', async () => {
    const result = await handleEmailOutboxEvent({
      ...fakeOutboxEvent,
      eventType: 'TICKET_RESOLVED',
      aggregateId: 'ticket-1',
    } as never);

    expect(result.status).toBe('failure');
  });

  it('marks retryable provider failure as failure', async () => {
    mockedTicketFindFirst.mockResolvedValueOnce({ id: 'ticket-1', title: 'Judul Tiket' } as never);
    mockedUserFindFirst.mockResolvedValueOnce({ id: 'user-456', email: 'assignee@example.com', name: 'Assignee' } as never);
    mockedSendEmail.mockResolvedValueOnce({ status: 'retryable_failure', error: { code: 'RETRYABLE_FAILURE', message: 'temporarily unavailable', retryable: true } });

    const result = await handleEmailOutboxEvent(fakeOutboxEvent as never);

    expect(result.status).toBe('failure');
    expect((result as { error?: { retryable?: boolean } }).error?.retryable).toBe(true);
  });
});
