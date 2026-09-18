import { prisma } from '@/lib/db/prisma';
import type { OutboxHandler, OutboxHandlerResult } from './types';
import type { OutboxEventRecord } from '@/lib/outbox/types';
import {
  completeHandoff,
  DEFAULT_EXECUTION_LEASE_MS,
} from '@/lib/automation/execution-service';
import {
  shouldEvaluateEvent,
  findMatchingRules,
  type EvaluationContext,
} from '@/lib/automation/evaluator';
import type { Prisma } from '@/generated/prisma';

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export const handleAutomationEvaluation: OutboxHandler = async (
  event: OutboxEventRecord,
): Promise<OutboxHandlerResult> => {
  const payload = event.payload as {
    triggerType: string;
    triggerPayload: Record<string, unknown>;
    automationContext: {
      causedByAutomation: boolean;
      ruleId?: string;
      executionId?: string;
      actionIndex?: number;
      actorId: string | null;
    };
    workspaceId: string;
    ticketId: string;
    actorId: string | null;
  };

  const { automationContext } = payload;

  // Recursion prevention: skip events caused by automation
  if (shouldEvaluateEvent(automationContext)) {
    return { status: 'success' };
  }

  const workerId = `worker-${process.pid}-${Date.now()}`;

  try {
    // Load enabled rules for this workspace + trigger type
    const rules = await prisma.automationRule.findMany({
      where: {
        workspaceId: payload.workspaceId,
        enabled: true,
        triggerType: payload.triggerType,
      },
    });

    if (rules.length === 0) {
      return { status: 'success' };
    }

    // Evaluate conditions (pure/in-memory, no transaction needed)
    const context: EvaluationContext = {
      triggerType: payload.triggerType as EvaluationContext['triggerType'],
      triggerPayload: payload.triggerPayload,
      ticketId: payload.ticketId,
      workspaceId: payload.workspaceId,
      actorId: payload.actorId,
    };

    const ruleConfigs = rules.map((rule) => ({
      id: rule.id,
      workspaceId: rule.workspaceId,
      name: rule.name,
      enabled: rule.enabled,
      triggerType: rule.triggerType,
      conditions: rule.conditions as unknown[],
      actions: rule.actions as { actionType: string; actionConfig: Record<string, unknown> }[],
    }));

    const matchingRules = findMatchingRules(ruleConfigs, context);

    if (matchingRules.length === 0) {
      return { status: 'success' };
    }

    const rule = matchingRules[0];
    const actions = rule.actions;

    // Zero-action rule → skip (defensive)
    if (!actions || actions.length === 0) {
      return { status: 'success' };
    }

    // Create execution record (auto-commit, P2002-safe)
    // The unique constraint on (sourceEventId, ruleId) prevents duplicates.
    // We use the event.id as sourceEventId — each outbox event is unique.
    let executionId: string;

    try {
      const execution = await prisma.automationExecution.create({
        data: {
          workspaceId: payload.workspaceId,
          ruleId: rule.id,
          sourceEventType: event.eventType,
          sourceEventId: event.id,
          sourceAggregateId: payload.ticketId,
          ticketId: payload.ticketId,
          status: 'evaluating',
          leasedBy: workerId,
          leasedAt: new Date(Date.now() + DEFAULT_EXECUTION_LEASE_MS),
        },
      });
      executionId = execution.id;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // Another worker already created the execution — safe no-op
        return { status: 'success' };
      }
      throw error;
    }

    // Atomic handoff: create all intents + transition to awaiting_actions
    // This is a single transaction — either all intents are created and
    // the execution transitions to awaiting_actions, or nothing is committed.
    try {
      const actionsForHandoff = actions.map((a) => ({
        actionType: a.actionType,
        actionConfig: JSON.parse(JSON.stringify(a.actionConfig)) as Prisma.InputJsonValue,
      }));
      await completeHandoff(executionId, actionsForHandoff, workerId);
    } catch (error) {
      // Handoff failed — transition to failed state
      await prisma.automationExecution.update({
        where: { id: executionId },
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Handoff failed',
          leasedBy: null,
          leasedAt: null,
        },
      });
      throw error;
    }

    return { status: 'success' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[automation] Failed to process evaluation for event ${event.id}:`, message);
    return { status: 'failure', error: { message, retryable: true } };
  }
};
