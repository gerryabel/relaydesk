import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { queueAutomationEvaluation, queueSemanticDomainEvent } from '@/lib/automation/outbox';
import { createOutboxEvent } from '@/lib/outbox/outbox';
import { createAutomationContext } from '@/lib/automation/context';

vi.mock('@/lib/outbox/outbox', () => ({
  createOutboxEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('automation outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('queueAutomationEvaluation', () => {
    it('creates AUTOMATION_EVALUATION outbox event with correct payload', async () => {
      const tx = {} as never;

      await queueAutomationEvaluation(
        tx,
        'ticket.created',
        {
          workspaceId: 'workspace-1',
          ticketId: 'ticket-1',
          actorId: 'user-1',
          automationContext: createAutomationContext({ actorId: 'user-1' }),
          triggerPayload: { priority: 'high' },
        },
        'ticket-1',
      );

      expect(createOutboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'AUTOMATION_EVALUATION',
          aggregateType: 'Ticket',
          aggregateId: 'ticket-1',
          payload: expect.objectContaining({
            triggerType: 'ticket.created',
            triggerPayload: { priority: 'high' },
            automationContext: {
              causedByAutomation: false,
              actorId: 'user-1',
            },
            workspaceId: 'workspace-1',
            ticketId: 'ticket-1',
            actorId: 'user-1',
          }),
        }),
        tx,
      );
    });

    it('uses ticketId as aggregateId when sourceAggregateId is not provided', async () => {
      const tx = {} as never;

      await queueAutomationEvaluation(
        tx,
        'ticket.status_changed',
        {
          workspaceId: 'workspace-1',
          ticketId: 'ticket-2',
          actorId: 'user-1',
          automationContext: createAutomationContext({ actorId: 'user-1' }),
        },
      );

      expect(createOutboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateId: 'ticket-2',
        }),
        tx,
      );
    });

    it('defaults triggerPayload to empty object', async () => {
      const tx = {} as never;

      await queueAutomationEvaluation(
        tx,
        'ticket.assigned',
        {
          workspaceId: 'workspace-1',
          ticketId: 'ticket-3',
          actorId: null,
          automationContext: createAutomationContext({ actorId: null }),
        },
      );

      expect(createOutboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            triggerPayload: {},
            automationContext: expect.objectContaining({
              causedByAutomation: false,
              actorId: null,
            }),
          }),
        }),
        tx,
      );
    });
  });

  describe('queueSemanticDomainEvent', () => {
    it('creates SLA_BREACHED outbox event', async () => {
      const tx = {} as never;

      await queueSemanticDomainEvent(tx, 'SLA_BREACHED', 'ticket-1', {
        ticketId: 'ticket-1',
        slaType: 'response',
        workspaceId: 'workspace-1',
      });

      expect(createOutboxEvent).toHaveBeenCalledWith(
        {
          eventType: 'SLA_BREACHED',
          aggregateType: 'Ticket',
          aggregateId: 'ticket-1',
          payload: {
            ticketId: 'ticket-1',
            slaType: 'response',
            workspaceId: 'workspace-1',
          },
        },
        tx,
      );
    });

    it('creates TICKET_CREATED outbox event', async () => {
      const tx = {} as never;

      await queueSemanticDomainEvent(tx, 'TICKET_CREATED', 'ticket-1', {
        ticketId: 'ticket-1',
        workspaceId: 'workspace-1',
        actorId: 'user-1',
      });

      expect(createOutboxEvent).toHaveBeenCalledWith(
        {
          eventType: 'TICKET_CREATED',
          aggregateType: 'Ticket',
          aggregateId: 'ticket-1',
          payload: {
            ticketId: 'ticket-1',
            workspaceId: 'workspace-1',
            actorId: 'user-1',
          },
        },
        tx,
      );
    });
  });
});
