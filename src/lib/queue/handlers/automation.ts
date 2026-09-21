import { prisma } from '@/lib/db/prisma';
import type { OutboxHandler, OutboxHandlerResult } from './types';
import type { OutboxEventRecord } from '@/lib/outbox/types';
import {
  completeHandoff,
  skipExecution,
  DEFAULT_EXECUTION_LEASE_MS,
} from '@/lib/automation/execution-service';
import {
  shouldEvaluateEvent,
  findMatchingRules,
  type EvaluationContext,
} from '@/lib/automation/evaluator';
import type { Prisma } from '@/generated/prisma';
import { ZodError } from 'zod';
import { InvalidTicketTransitionError } from '@/lib/tickets/workflow';
import { RuleValidationError, RuleReferencedResourceError } from '@/lib/automation/rules';

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * Sentinel prefix marking a failed execution as permanently failed.
 * Used by the P2002 reclaim path to distinguish a permanent (configuration)
 * failure — which must remain terminal — from a transient (infrastructure)
 * failure, which should be reclaimed and retried.
 */
const PERMANENT_FAILURE_PREFIX = '[permanent] ';

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
  if (!shouldEvaluateEvent(automationContext)) {
    return { status: 'success' };
  }

  const workerId = `worker-${process.pid}-${Date.now()}`;

  try {
    // Load enabled rules for this workspace + trigger type,
    // ordered deterministically: priority ASC → createdAt ASC → id ASC.
    const rules = await prisma.automationRule.findMany({
      where: {
        workspaceId: payload.workspaceId,
        enabled: true,
        triggerType: payload.triggerType,
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
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

    // Multi-rule evaluation: one execution per matching rule, in priority order.
    // Each rule is processed independently — a failure in one does not block
    // others. Transient failures bubble up so BullMQ can retry; permanent
    // failures are recorded on the individual execution.
    const transientFailures: { ruleId: string; error: string }[] = [];

    for (const rule of matchingRules) {
      const actions = rule.actions ?? [];
      let executionId: string | null = null;

      let reclaimed = false;

      try {
        // Create execution record (auto-commit, P2002-safe).
        // The unique constraint on (sourceEventId, ruleId) prevents duplicates.
        // We use the event.id as sourceEventId — each outbox event is unique.
        try {
          const execution = await prisma.automationExecution.create({
            data: {
              workspaceId: payload.workspaceId,
              ruleId: rule.id,
              ruleNameSnapshot: rule.name,
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
            // The execution already exists for (sourceEventId, ruleId). The outbox
            // processor retries the SAME event.id after a transient failure, so
            // this row may be a prior transient failure that must be reclaimed
            // and retried. Inspect its status to decide:
            //   - 'failed' with a [permanent] error prefix → terminal, skip.
            //   - 'failed' without the prefix (transient) → reclaim + retry.
            //   - 'evaluating' with an active lease held by another worker → skip.
            //   - 'awaiting_actions' / 'executing' / 'completed' → success, skip.
            const existing = await prisma.automationExecution.findFirst({
              where: { sourceEventId: event.id, ruleId: rule.id },
            });
            if (!existing) {
              // Row vanished between P2002 and findFirst — re-throw so the
              // outer catch classifies the P2002.
              throw error;
            }
            const decision = classifyExistingExecution(existing);
            if (decision === 'skip') {
              continue;
            }
            // decision === 'reclaim': adopt this execution as ours, re-leasing
            // it so completeHandoff's lease-fenced transition will succeed.
            executionId = existing.id;
            reclaimed = true;
            if (!(await tryReclaimExecution(existing.id, workerId))) {
              // Reclaim raced with another worker; skip and let them finish.
              continue;
            }
          } else {
            throw error;
          }
        }

        // Zero-action matched rule → skip with lease-fenced transition.
        if (actions.length === 0) {
          await skipExecution(executionId, 'no_actions', workerId);
          continue;
        }

        // Atomic handoff: create all intents + transition to awaiting_actions.
        // On a reclaimed execution this is safe: completeHandoff uses
        // createMany(..., skipDuplicates: true) for intents and re-leases
        // via its lease-fenced updateMany, so no duplicate intents or
        // orphaned first-action events are produced.
        const actionsForHandoff = actions.map((a) => ({
          actionType: a.actionType,
          actionConfig: JSON.parse(JSON.stringify(a.actionConfig)) as Prisma.InputJsonValue,
        }));
        await completeHandoff(executionId, actionsForHandoff, workerId);
      } catch (error) {
        // Classify the failure: permanent (configuration) vs transient (infra).
        const classification = classifyRuleProcessingError(error);
        const message = error instanceof Error ? error.message : String(error);
        // Permanent failures get a [permanent] prefix so a later retry's
        // P2002 reclaim path recognizes them as terminal and does not retry.
        const storedMessage =
          classification === 'permanent' ? `${PERMANENT_FAILURE_PREFIX}${message}` : message;

        if (executionId) {
          // Record the failure on the execution so it's observable. For a
          // reclaimed execution this overwrites the prior failed state; the
          // lease fence ensures we only update rows we own.
          await prisma.automationExecution.updateMany({
            where: { id: executionId, ...(reclaimed ? { leasedBy: workerId } : {}) },
            data: {
              status: 'failed',
              error: storedMessage,
              leasedBy: null,
              leasedAt: null,
            },
          });
        } else {
          // Execution was never created — create a failed row for visibility.
          // This path should be rare (create threw before executionId assigned).
          try {
            await prisma.automationExecution.create({
              data: {
                workspaceId: payload.workspaceId,
                ruleId: rule.id,
                ruleNameSnapshot: rule.name,
                sourceEventType: event.eventType,
                sourceEventId: event.id,
                sourceAggregateId: payload.ticketId,
                ticketId: payload.ticketId,
                status: 'failed',
                error: storedMessage,
              },
            });
          } catch {
            // Even the failure-record create failed — log and continue.
            console.error('[automation] Failed to record execution failure', { ruleId: rule.id, error: storedMessage });
          }
        }

        if (classification === 'transient') {
          transientFailures.push({ ruleId: rule.id, error: message });
        }
        // Permanent failures are recorded on the execution and NOT retried.
        // Continue to the next rule.
        continue;
      }
    }

    // If any transient failures occurred, bubble up so BullMQ retries.
    // Already-succeeded rules are protected by (sourceEventId, ruleId)
    // idempotency — their next create hits P2002 and is skipped.
    if (transientFailures.length > 0) {
      const messages = transientFailures.map((f) => `${f.ruleId}: ${f.error}`).join('; ');
      return {
        status: 'failure',
        error: {
          message: `${transientFailures.length} rule(s) failed transiently: ${messages}`,
          retryable: true,
        },
      };
    }

    return { status: 'success' };
  } catch (error) {
    // Top-level unexpected failure — treat as transient (retryable).
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[automation] Failed to process evaluation for event ${event.id}:`, message);
    return { status: 'failure', error: { message, retryable: true } };
  }
};

/**
 * Classify a rule-processing failure as permanent (configuration/validation)
 * or transient (infrastructure/DB that should be retried).
 *
 * Permanent failures are recorded on the execution and NOT retried.
 * Transient failures bubble up as retryable overall failures.
 */
function classifyRuleProcessingError(error: unknown): 'permanent' | 'transient' {
  // Prisma unique constraint (P2002) — duplicate name, already handled but defensive.
  if (isUniqueConstraintError(error)) {
    return 'permanent';
  }

  // Prisma transaction conflict (P2034) — concurrent transaction, retry.
  if (isPrismaError(error, 'P2034')) {
    return 'transient';
  }

  // Prisma connection timeout (P2024) — DB unavailable, retry.
  if (isPrismaError(error, 'P2024')) {
    return 'transient';
  }

  // Prisma transaction API error (P2028) — transaction state error, retry.
  if (isPrismaError(error, 'P2028')) {
    return 'transient';
  }

  // Known domain validation/config errors — permanent.
  if (error instanceof InvalidTicketTransitionError) {
    return 'permanent';
  }

  if (error instanceof ZodError) {
    return 'permanent';
  }

  if (error instanceof RuleValidationError || error instanceof RuleReferencedResourceError) {
    return 'permanent';
  }

  // Network/connection errors — transient.
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('socket hang up') ||
      msg.includes('network')
    ) {
      return 'transient';
    }
  }

  // Unknown/unexpected errors — treat as transient (retryable) to avoid
  // silently swallowing unexpected failures.
  return 'transient';
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === code
  );
}

/**
 * Decision for an existing execution found on the P2002 path:
 *   - 'skip'    → do not touch it (terminal success, permanent failure, or
 *                 actively leased by another worker).
 *   - 'reclaim' → this worker may adopt and retry it.
 */
type ExecutionDecision = 'skip' | 'reclaim';

/**
 * Decide what to do with an existing (sourceEventId, ruleId) execution found
 * when the handler's insert hit P2002. The same outbox event.id is replayed
 * after a transient failure, so this distinguishes a prior transient failure
 * (reclaim) from terminal states (skip).
 */
export function classifyExistingExecution(row: {
  status: string;
  leasedBy: string | null;
  leasedAt: Date | null;
  error: string | null;
}): ExecutionDecision {
  switch (row.status) {
    case 'failed': {
      // Permanent configuration/validation failure → terminal, do not retry.
      if ((row.error ?? '').startsWith(PERMANENT_FAILURE_PREFIX)) {
        return 'skip';
      }
      // Transient failure with no active lease → reclaim and retry.
      if (row.leasedBy === null || row.leasedAt === null || row.leasedAt <= new Date()) {
        return 'reclaim';
      }
      // Failed but still listed as leased (defensive — the catch block clears
      // leases, so this shouldn't happen) → skip.
      return 'skip';
    }
    case 'evaluating':
      // In-progress. Another worker holding a valid lease → skip (don't
      // duplicate). An expired lease means the execution is stranded → reclaim.
      if (row.leasedBy !== null && row.leasedAt !== null && row.leasedAt > new Date()) {
        return 'skip';
      }
      return 'reclaim';
    case 'awaiting_actions':
    case 'executing':
    case 'completed':
    case 'skipped':
      // Terminal success states → idempotent skip.
      return 'skip';
    case 'partial_failure':
      // Partial failure is terminal; do not reclaim.
      return 'skip';
    default:
      return 'skip';
  }
}

/**
 * Re-lease a failed or stranded execution to the current worker so that a
 * subsequent completeHandoff can transition it. Lease-fenced: only succeeds
 * if the row is still in 'failed'/'evaluating' and not held by another
 * worker with a valid lease. Returns true if this worker now owns the lease.
 */
export async function tryReclaimExecution(
  executionId: string,
  workerId: string,
): Promise<boolean> {
  const now = new Date();
  const { count } = await prisma.automationExecution.updateMany({
    where: {
      id: executionId,
      status: { in: ['failed', 'evaluating'] },
      OR: [
        { leasedBy: null },
        { leasedAt: null },
        { leasedAt: { lte: now } },
      ],
    },
    data: {
      leasedBy: workerId,
      leasedAt: new Date(now.getTime() + DEFAULT_EXECUTION_LEASE_MS),
      error: null,
    },
  });
  return count === 1;
}
