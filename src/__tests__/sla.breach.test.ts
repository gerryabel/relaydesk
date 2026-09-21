import { describe, it, expect, vi } from 'vitest';
import { claimBreachSlot, createSlaBreachedOutboxEvent } from '@/lib/sla/breach';
import type { PrismaClient, Prisma } from '@/generated/prisma';

describe('SLA breach', () => {
  describe('claimBreachSlot', () => {
    it('claims slot successfully on first attempt', async () => {
      const mockDb = {
        sentSlaBreachNotification: {
          create: vi.fn().mockResolvedValue({ id: 'breach-1' }),
        },
      } as unknown as PrismaClient;

      const result = await claimBreachSlot(mockDb, 'ticket-1', 'response');

      expect(result).toEqual({ claimed: true, isNew: true });
      expect(mockDb.sentSlaBreachNotification.create).toHaveBeenCalledWith({
        data: { ticketId: 'ticket-1', slaType: 'response', sentAt: expect.any(Date) },
      });
    });

    it('does not claim when slot already exists', async () => {
      const uniqueError = new Error('Unique constraint failed') as Error & { code: string };
      uniqueError.code = 'P2002';

      const mockDb = {
        sentSlaBreachNotification: {
          create: vi.fn().mockRejectedValue(uniqueError),
        },
      } as unknown as PrismaClient;

      const result = await claimBreachSlot(mockDb, 'ticket-1', 'response');

      expect(result).toEqual({ claimed: false, isNew: false });
    });

    it('throws on non-unique errors', async () => {
      const otherError = new Error('Database connection failed');

      const mockDb = {
        sentSlaBreachNotification: {
          create: vi.fn().mockRejectedValue(otherError),
        },
      } as unknown as PrismaClient;

      await expect(claimBreachSlot(mockDb, 'ticket-1', 'response')).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('createSlaBreachedOutboxEvent', () => {
    it('creates outbox event with correct payload', async () => {
      const createOutboxEvent = vi.fn().mockResolvedValue(undefined);

      const tx = {
        outboxEvent: { create: createOutboxEvent },
      } as unknown as Prisma.TransactionClient;

      await createSlaBreachedOutboxEvent('ticket-1', 'response', 'workspace-1', 'user-1', tx);

      expect(createOutboxEvent).toHaveBeenCalledWith({
        data: {
          eventType: 'SLA_BREACHED',
          aggregateType: 'Ticket',
          aggregateId: 'ticket-1',
          payload: {
            ticketId: 'ticket-1',
            slaType: 'response',
            workspaceId: 'workspace-1',
            assignedToId: 'user-1',
          },
        },
      });
    });

    it('handles null assignedToId', async () => {
      const createOutboxEvent = vi.fn().mockResolvedValue(undefined);

      const tx = {
        outboxEvent: { create: createOutboxEvent },
      } as unknown as Prisma.TransactionClient;

      await createSlaBreachedOutboxEvent('ticket-1', 'resolution', 'workspace-1', null, tx);

      expect(createOutboxEvent).toHaveBeenCalledWith({
        data: {
          eventType: 'SLA_BREACHED',
          aggregateType: 'Ticket',
          aggregateId: 'ticket-1',
          payload: {
            ticketId: 'ticket-1',
            slaType: 'resolution',
            workspaceId: 'workspace-1',
            assignedToId: null,
          },
        },
      });
    });
  });
});
