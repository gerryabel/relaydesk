import { createOutboxEvent, type CreateOutboxEventInput } from '@/lib/outbox/outbox';
import type { Prisma } from '@/generated/prisma';
import type { AutomationTriggerType } from './types';

export interface QueueAutomationEvaluationInput {
  workspaceId: string;
  ticketId: string;
  actorId: string | null;
  triggerPayload?: Record<string, unknown>;
}

export async function queueAutomationEvaluation(
  tx: Prisma.TransactionClient,
  triggerType: AutomationTriggerType,
  input: QueueAutomationEvaluationInput,
  sourceAggregateId?: string,
): Promise<void> {
  const payloadObj = {
    triggerType,
    triggerPayload: input.triggerPayload ?? {},
    automationContext: {
      causedByAutomation: false,
      actorId: input.actorId,
    },
    workspaceId: input.workspaceId,
    ticketId: input.ticketId,
    actorId: input.actorId,
  };

  await createOutboxEvent(
    {
      eventType: 'AUTOMATION_EVALUATION',
      aggregateType: 'Ticket',
      aggregateId: sourceAggregateId ?? input.ticketId,
      payload: payloadObj as CreateOutboxEventInput['payload'],
    },
    tx,
  );
}

export async function queueSemanticDomainEvent(
  tx: Prisma.TransactionClient,
  eventType: 'TICKET_CREATED' | 'SLA_BREACHED',
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await createOutboxEvent(
    {
      eventType,
      aggregateType: 'Ticket',
      aggregateId,
      payload: payload as CreateOutboxEventInput['payload'],
    },
    tx,
  );
}
