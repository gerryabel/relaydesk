import type { Prisma } from '@/generated/prisma';
import type { AutomationActionType } from './schema';

/**
 * Context passed to every action handler.
 *
 * Contains the minimal information a handler needs to execute an action
 * in a worker-safe way — no HTTP session, no getCurrentMembership().
 */
export interface ActionContext {
  /** The AutomationExecution that owns this action. */
  executionId: string;
  /** Workspace the execution belongs to. */
  workspaceId: string;
  /** Ticket the actions target. */
  ticketId: string;
  /** Index of this action within the rule. */
  actionIndex: number;
  /** Type of this action. */
  actionType: AutomationActionType;
  /** Parsed action config. */
  actionConfig: Record<string, unknown>;
  /**
   * Automation context threaded through domain mutations so downstream
   * outbox events can be flagged causedByAutomation=true.
   */
  automationContext: {
    causedByAutomation: boolean;
    ruleId: string | null;
    executionId: string;
    actionIndex: number;
    actorId: string | null;
  };
}

/**
 * Result of a successful action execution.
 */
export interface ActionResult {
  status: 'completed';
  /** Optional human-readable summary, surfaced in the execution record. */
  summary?: string;
}

/**
 * Result of a permanently-failed action.
 *
 * Permanent failures are recorded but do NOT block later actions.
 */
export interface ActionPermanentFailure {
  status: 'failed';
  error: string;
}

/**
 * Result of a transiently-failed action.
 *
 * Transparent failures are reported back to BullMQ for retry.
 */
export interface ActionTransientFailure {
  status: 'retryable';
  error: string;
}

export type ActionHandlerResult =
  | ActionResult
  | ActionPermanentFailure
  | ActionTransientFailure;

/**
 * A single automation action handler.
 *
 * Handlers MUST be idempotent (see task spec). They receive a fresh
 * Prisma transaction client for atomicity, but should prefer to use
 * naturally-idempotent operations or the dedupe-key APIs where possible.
 */
export type ActionHandler = (
  ctx: ActionContext,
  tx: Prisma.TransactionClient,
) => Promise<ActionHandlerResult>;
