import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@/generated/prisma';

export const DEFAULT_EXECUTION_LEASE_MS = 5 * 60 * 1000;

export class ExecutionNotFoundError extends Error {
  constructor(message = 'Automation execution not found') {
    super(message);
    this.name = 'ExecutionNotFoundError';
  }
}

export class ExecutionClaimError extends Error {
  constructor(message = 'Failed to claim automation execution') {
    super(message);
    this.name = 'ExecutionClaimError';
  }
}

export interface CreateExecutionInput {
  workspaceId: string;
  ruleId: string;
  sourceEventType: string;
  sourceEventId: string;
  sourceAggregateId: string;
  ticketId: string | null;
  workerId: string;
  leaseMs?: number;
}

export interface ActionResult {
  skipped: boolean;
  skipReason?: string;
  error?: string;
}

export async function createExecution(input: CreateExecutionInput) {
  const { sourceEventId, ruleId } = input;

  try {
    const execution = await prisma.automationExecution.create({
      data: {
        workspaceId: input.workspaceId,
        ruleId: input.ruleId,
        sourceEventType: input.sourceEventType,
        sourceEventId: input.sourceEventId,
        sourceAggregateId: input.sourceAggregateId,
        ticketId: input.ticketId,
        status: 'evaluating',
        leasedBy: input.workerId,
        leasedAt: new Date(Date.now() + (input.leaseMs ?? DEFAULT_EXECUTION_LEASE_MS)),
      },
    });

    return execution;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await prisma.automationExecution.findUnique({
        where: {
          sourceEventId_ruleId: {
            sourceEventId,
            ruleId,
          },
        },
      });

      if (existing) {
        return { execution: existing, created: false };
      }
    }

    throw error;
  }
}

export async function completeHandoff(
  executionId: string,
  ruleActions: { actionType: string; actionConfig: Prisma.InputJsonValue }[],
  workerId: string,
) {
  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const intentsData = ruleActions.map((action, index) => ({
        executionId,
        actionIndex: index,
        actionType: action.actionType,
        actionConfig: action.actionConfig ?? {},
        status: 'pending' as const,
        startedAt: null,
        completedAt: null,
      }));

      await tx.automationActionExecution.createMany({
        data: intentsData,
        skipDuplicates: true,
      });

      const expectedCount = ruleActions.length;
      const actualCount = await tx.automationActionExecution.count({
        where: { executionId },
      });

      if (actualCount !== expectedCount) {
        throw new Error(`Intent count mismatch: expected ${expectedCount}, got ${actualCount}`);
      }

      const { count } = await tx.automationExecution.updateMany({
        where: {
          id: executionId,
          status: 'evaluating',
          leasedBy: workerId,
          leasedAt: { gt: now },
        },
        data: {
          status: 'awaiting_actions',
          evaluatedConditions: true,
          leasedBy: null,
          leasedAt: null,
        },
      });

      if (count !== 1) {
        throw new Error(`Handoff failed: execution ${executionId} not in expected state`);
      }

      const updated = await tx.automationExecution.findUnique({
        where: { id: executionId },
      });

      return updated;
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Intent count mismatch')) {
      throw error;
    }
    if (isUniqueConstraintError(error)) {
      const existing = await prisma.automationExecution.findUnique({
        where: { id: executionId },
      });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function skipExecution(
  executionId: string,
  reason: string,
  workerId: string,
) {
  const now = new Date();

  const { count } = await prisma.automationExecution.updateMany({
    where: {
      id: executionId,
      status: 'evaluating',
      leasedBy: workerId,
      leasedAt: { gt: now },
    },
    data: {
      status: 'skipped',
      skipReason: reason,
      leasedBy: null,
      leasedAt: null,
    },
  });

  if (count !== 1) {
    throw new ExecutionClaimError(`Cannot skip execution ${executionId}: not owned or lease expired`);
  }

  return prisma.automationExecution.findUnique({
    where: { id: executionId },
  });
}

export async function failExecution(
  executionId: string,
  error: string,
  workerId: string,
) {
  const now = new Date();

  const { count } = await prisma.automationExecution.updateMany({
    where: {
      id: executionId,
      status: 'evaluating',
      leasedBy: workerId,
      leasedAt: { gt: now },
    },
    data: {
      status: 'failed',
      error,
      leasedBy: null,
      leasedAt: null,
    },
  });

  if (count !== 1) {
    throw new ExecutionClaimError(`Cannot fail execution ${executionId}: not owned or lease expired`);
  }

  return prisma.automationExecution.findUnique({
    where: { id: executionId },
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
