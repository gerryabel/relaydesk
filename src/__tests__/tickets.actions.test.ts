import { describe, it, expect, vi, afterEach } from 'vitest';
import { updateTicketAction, closeTicketAction } from '@/lib/tickets/actions';
import { InvalidTicketTransitionError } from '@/lib/tickets/workflow';
import { getCurrentMembership } from '@/lib/workspace/server';
import { updateTicket, closeTicket } from '@/lib/tickets/server';

vi.mock('@/lib/workspace/server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workspace/server')>('@/lib/workspace/server');
  return {
    ...actual,
    getCurrentMembership: vi.fn(),
  };
});

vi.mock('@/lib/tickets/server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tickets/server')>('@/lib/tickets/server');
  return {
    ...actual,
    updateTicket: vi.fn(),
    closeTicket: vi.fn(),
  };
});

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);
const mockedUpdateTicket = vi.mocked(updateTicket);
const mockedCloseTicket = vi.mocked(closeTicket);

afterEach(() => {
  vi.resetAllMocks();
  mockedGetCurrentMembership.mockResolvedValue({
    userId: 'user-123',
    workspaceId: 'workspace-123',
    workspace: {
      id: 'workspace-123',
      name: 'Workspace 123',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    },
  } as never);
  mockedUpdateTicket.mockReset();
  mockedCloseTicket.mockReset();
});

describe('ticket server actions', () => {
  describe('updateTicketAction', () => {
    it('returns error when invalid transition is requested', async () => {
      mockedUpdateTicket.mockRejectedValueOnce(
        new InvalidTicketTransitionError({
          current: 'resolved',
          requested: 'waiting_customer',
          message: 'Invalid status transition from resolved to waiting_customer',
        }),
      );

      const result = await updateTicketAction('ticket-1', { status: 'waiting_customer', description: undefined });

      expect(result.error).toBe('Invalid status transition from resolved to waiting_customer');
      expect(result.success).toBeUndefined();
    });
  });

  describe('closeTicketAction', () => {
    it('returns error when invalid transition is requested', async () => {
      mockedCloseTicket.mockRejectedValueOnce(
        new InvalidTicketTransitionError({
          current: 'open',
          requested: 'closed',
          message: 'Invalid status transition from open to closed',
        }),
      );

      const result = await closeTicketAction('ticket-1');

      expect(result.error).toBe('Invalid status transition from open to closed');
      expect(result.success).toBeUndefined();
    });
  });
});
