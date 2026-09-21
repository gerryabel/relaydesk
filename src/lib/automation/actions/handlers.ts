import type { Prisma } from '@/generated/prisma';
import type { ActionContext, ActionHandler, ActionHandlerResult, ActionResult } from './types';
import { assignActionSchema, unassignActionSchema, setStatusActionSchema, setPriorityActionSchema, addTagActionSchema, removeTagActionSchema, internalNoteActionSchema, notificationActionSchema } from './schema';
import { assertTransitionAllowed, InvalidTicketTransitionError } from '@/lib/tickets/workflow';
import { createAutomationInternalNote } from '@/lib/internal-notes/automation';
import { createAutomationNotification } from '@/lib/notifications/automation';
import { queueAutomationEvaluation } from '@/lib/automation/outbox';
import { createAutomationContext } from '@/lib/automation/context';

/**
 * Helper: build a completed result.
 */
function completed(summary?: string): ActionResult {
  return { status: 'completed', summary };
}

/**
 * Helper: build a permanent (non-retryable) failure.
 */
function permanentFailure(error: string): ActionHandlerResult {
  return { status: 'failed', error };
}

/**
 * Emit an AUTOMATION_EVALUATION outbox event for an automation-triggered
 * domain mutation.
 *
 * The causedByAutomation flag is placed in automationContext (not triggerPayload)
 * because the evaluator checks automationContext.causedByAutomation to decide
 * whether to skip the event. This is the recursion-prevention mechanism.
 */
async function emitAutomationEvent(
  tx: Prisma.TransactionClient,
  ctx: ActionContext,
  triggerType: Parameters<typeof queueAutomationEvaluation>[1],
  triggerPayload: Record<string, unknown>,
  aggregateId: string,
): Promise<void> {
  await queueAutomationEvaluation(
    tx,
    triggerType,
    {
      workspaceId: ctx.workspaceId,
      ticketId: ctx.ticketId,
      actorId: null,
      automationContext: createAutomationContext({
        causedByAutomation: true,
        ruleId: ctx.automationContext.ruleId,
        executionId: ctx.automationContext.executionId,
        actionIndex: ctx.automationContext.actionIndex,
        actorId: null,
      }),
      triggerPayload,
    },
    aggregateId,
  );
}

// ── assign ──────────────────────────────────────────────────────────────────

const assignHandler: ActionHandler = async (ctx, tx) => {
  const parsed = assignActionSchema.parse(ctx.actionConfig);
  const { assigneeId } = parsed;

  // Verify workspace membership of the assignee.
  const membership = await tx.membership.findFirst({
    where: { userId: assigneeId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!membership) {
    return permanentFailure(`Assignee ${assigneeId} is not a member of workspace ${ctx.workspaceId}`);
  }

  // Load the ticket with its workspace.
  const ticket = await tx.ticket.findFirst({
    where: { id: ctx.ticketId, workspaceId: ctx.workspaceId },
    select: { id: true, assignedToId: true, workspaceId: true },
  });
  if (!ticket) {
    return permanentFailure(`Ticket ${ctx.ticketId} not found in workspace ${ctx.workspaceId}`);
  }

  // Natural idempotency: if already assigned to this user, no-op.
  if (ticket.assignedToId === assigneeId) {
    return completed('already-assigned');
  }

  // Perform the assignment with automation context so the downstream event
  // is flagged causedByAutomation=true.
  await performAssign(tx, ctx, assigneeId);

  return completed(`assigned:${assigneeId}`);
};

/**
 * Perform an assignment carrying the automation context through to the
 * downstream domain event.
 *
 * Reuses the domain logic in assignTicket but threads the automation
 * context so the emitted outbox event is flagged to prevent recursion.
 */
async function performAssign(
  tx: Prisma.TransactionClient,
  ctx: ActionContext,
  assigneeId: string,
): Promise<void> {
  const ticket = await tx.ticket.findFirst({
    where: { id: ctx.ticketId, workspaceId: ctx.workspaceId },
    select: { id: true, assignedToId: true },
  });
  if (!ticket) {
    throw new Error(`Ticket ${ctx.ticketId} not found in workspace ${ctx.workspaceId}`);
  }

  const updated = await tx.ticket.update({
    where: { id: ctx.ticketId },
    data: { assignedToId: assigneeId },
    include: { createdBy: true, assignedTo: true, customer: true },
  });

  // TicketActivity for automation actions uses actorId=null to indicate a
  // system/automation action (no human actor). This matches the established
  // pattern in sla/evaluation.ts for system-generated events.
  await tx.ticketActivity.create({
    data: {
      ticketId: updated.id,
      actorId: null,
      type: 'TICKET_ASSIGNED',
      metadata: {
        from: ticket.assignedToId,
        to: assigneeId,
        causedByAutomation: true,
      },
    },
  });

  // Emit the automation-evaluation outbox event with causedByAutomation=true
  // in the automationContext (not triggerPayload) so the evaluator skips it
  // (recursion prevention). The evaluator checks automationContext.causedByAutomation.
  await emitAutomationEvent(
    tx,
    ctx,
    'ticket.assigned',
    {
      ticketId: updated.id,
      workspaceId: ctx.workspaceId,
      assigneeId,
      previousAssigneeId: ticket.assignedToId,
    },
    updated.id,
  );
}

// ── unassign ────────────────────────────────────────────────────────────────

const unassignHandler: ActionHandler = async (ctx, tx) => {
  unassignActionSchema.parse(ctx.actionConfig);

  const ticket = await tx.ticket.findFirst({
    where: { id: ctx.ticketId, workspaceId: ctx.workspaceId },
    select: { id: true, assignedToId: true },
  });
  if (!ticket) {
    return permanentFailure(`Ticket ${ctx.ticketId} not found in workspace ${ctx.workspaceId}`);
  }

  // Natural idempotency: if already unassigned, no-op.
  if (ticket.assignedToId === null) {
    return completed('already-unassigned');
  }

  const previousAssigneeId = ticket.assignedToId;

  const updated = await tx.ticket.update({
    where: { id: ctx.ticketId },
    data: { assignedToId: null },
    include: { createdBy: true, assignedTo: true, customer: true },
  });

  await tx.ticketActivity.create({
    data: {
      ticketId: updated.id,
      actorId: null,
      type: 'TICKET_UNASSIGNED',
      metadata: {
        from: previousAssigneeId,
        to: null,
        causedByAutomation: true,
      },
    },
  });

  await emitAutomationEvent(
    tx,
    ctx,
    'ticket.unassigned',
    {
      ticketId: updated.id,
      workspaceId: ctx.workspaceId,
      previousAssigneeId,
    },
    updated.id,
  );

  return completed('unassigned');
};

// ── set-status ──────────────────────────────────────────────────────────────

const setStatusHandler: ActionHandler = async (ctx, tx) => {
  const parsed = setStatusActionSchema.parse(ctx.actionConfig);
  const { status } = parsed;

  const ticket = await tx.ticket.findFirst({
    where: { id: ctx.ticketId, workspaceId: ctx.workspaceId },
    select: { id: true, status: true, resolvedAt: true },
  });
  if (!ticket) {
    return permanentFailure(`Ticket ${ctx.ticketId} not found in workspace ${ctx.workspaceId}`);
  }

  // Natural idempotency: if already in desired status, no-op.
  if (ticket.status === status) {
    return completed(`already-${status}`);
  }

  // Validate the transition (permanent failure if invalid).
  try {
    assertTransitionAllowed(ticket.status, status);
  } catch (error) {
    if (error instanceof InvalidTicketTransitionError) {
      return permanentFailure(error.message);
    }
    throw error;
  }

  const data: Prisma.TicketUpdateInput = { status };
  if (status === 'resolved' && !ticket.resolvedAt) {
    data.resolvedAt = new Date();
  }

  const updated = await tx.ticket.update({
    where: { id: ctx.ticketId },
    data,
    include: { createdBy: true, assignedTo: true, customer: true },
  });

  await tx.ticketActivity.create({
    data: {
      ticketId: updated.id,
      actorId: null,
      type: 'STATUS_CHANGED',
      metadata: {
        from: ticket.status,
        to: status,
        causedByAutomation: true,
      },
    },
  });

  await emitAutomationEvent(
    tx,
    ctx,
    'ticket.status_changed',
    {
      ticketId: updated.id,
      workspaceId: ctx.workspaceId,
      from: ticket.status,
      to: status,
    },
    updated.id,
  );

  return completed(`status:${status}`);
};

// ── set-priority ────────────────────────────────────────────────────────────

const setPriorityHandler: ActionHandler = async (ctx, tx) => {
  const parsed = setPriorityActionSchema.parse(ctx.actionConfig);
  const { priority } = parsed;

  const ticket = await tx.ticket.findFirst({
    where: { id: ctx.ticketId, workspaceId: ctx.workspaceId },
    select: { id: true, priority: true },
  });
  if (!ticket) {
    return permanentFailure(`Ticket ${ctx.ticketId} not found in workspace ${ctx.workspaceId}`);
  }

  // Natural idempotency: if already at desired priority, no-op.
  if (ticket.priority === priority) {
    return completed(`already-${priority}`);
  }

  const updated = await tx.ticket.update({
    where: { id: ctx.ticketId },
    data: { priority },
    include: { createdBy: true, assignedTo: true, customer: true },
  });

  await tx.ticketActivity.create({
    data: {
      ticketId: updated.id,
      actorId: null,
      type: 'PRIORITY_CHANGED',
      metadata: {
        from: ticket.priority,
        to: priority,
        causedByAutomation: true,
      },
    },
  });

  await emitAutomationEvent(
    tx,
    ctx,
    'ticket.priority_changed',
    {
      ticketId: updated.id,
      workspaceId: ctx.workspaceId,
      from: ticket.priority,
      to: priority,
    },
    updated.id,
  );

  return completed(`priority:${priority}`);
};

// ── add-tag ─────────────────────────────────────────────────────────────────

const addTagHandler: ActionHandler = async (ctx, tx) => {
  const parsed = addTagActionSchema.parse(ctx.actionConfig);
  const { tagId } = parsed;

  const [ticket, tag] = await Promise.all([
    tx.ticket.findFirst({
      where: { id: ctx.ticketId, workspaceId: ctx.workspaceId },
      select: { id: true, workspaceId: true },
    }),
    tx.tag.findFirst({
      where: { id: tagId },
      select: { id: true, workspaceId: true, name: true },
    }),
  ]);

  if (!ticket) {
    return permanentFailure(`Ticket ${ctx.ticketId} not found in workspace ${ctx.workspaceId}`);
  }
  if (!tag) {
    return permanentFailure(`Tag ${tagId} not found`);
  }
  if (tag.workspaceId !== ticket.workspaceId) {
    return permanentFailure(`Tag ${tagId} does not belong to workspace ${ctx.workspaceId}`);
  }

  // Natural idempotency: if the ticket already has this tag, no-op.
  const existing = await tx.ticketTag.findUnique({
    where: { ticketId_tagId: { ticketId: ticket.id, tagId: tag.id } },
    select: { ticketId: true },
  });
  if (existing) {
    return completed('tag-already-present');
  }

  try {
    await tx.ticketTag.create({
      data: { ticketId: ticket.id, tagId: tag.id },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // Lost a race — the tag is already present. Safe no-op.
      return completed('tag-already-present');
    }
    throw error;
  }

  await tx.ticketActivity.create({
    data: {
      ticketId: ticket.id,
      actorId: null,
      type: 'TAG_ADDED',
      metadata: {
        tagId: tag.id,
        tagName: tag.name,
        causedByAutomation: true,
      },
    },
  });

  await emitAutomationEvent(
    tx,
    ctx,
    'ticket.tag_added',
    {
      ticketId: ticket.id,
      workspaceId: ctx.workspaceId,
      tagId: tag.id,
      tagName: tag.name,
    },
    ticket.id,
  );

  return completed(`tag-added:${tagId}`);
};

// ── remove-tag ──────────────────────────────────────────────────────────────

const removeTagHandler: ActionHandler = async (ctx, tx) => {
  const parsed = removeTagActionSchema.parse(ctx.actionConfig);
  const { tagId } = parsed;

  const ticket = await tx.ticket.findFirst({
    where: { id: ctx.ticketId, workspaceId: ctx.workspaceId },
    select: { id: true, workspaceId: true },
  });
  if (!ticket) {
    return permanentFailure(`Ticket ${ctx.ticketId} not found in workspace ${ctx.workspaceId}`);
  }

  const ticketTag = await tx.ticketTag.findFirst({
    where: { ticketId: ticket.id, tagId },
    include: { tag: { select: { id: true, name: true, workspaceId: true } } },
  });

  // Natural idempotency: if the ticket doesn't have this tag, no-op.
  if (!ticketTag) {
    return completed('tag-already-absent');
  }

  const tag = ticketTag.tag;
  if (tag.workspaceId !== ticket.workspaceId) {
    return permanentFailure(`Tag ${tagId} does not belong to workspace ${ctx.workspaceId}`);
  }

  await tx.ticketTag.delete({
    where: { ticketId_tagId: { ticketId: ticket.id, tagId: tag.id } },
  });

  await tx.ticketActivity.create({
    data: {
      ticketId: ticket.id,
      actorId: null,
      type: 'TAG_REMOVED',
      metadata: {
        tagId: tag.id,
        tagName: tag.name,
        causedByAutomation: true,
      },
    },
  });

  await emitAutomationEvent(
    tx,
    ctx,
    'ticket.tag_removed',
    {
      ticketId: ticket.id,
      workspaceId: ctx.workspaceId,
      tagId: tag.id,
      tagName: tag.name,
    },
    ticket.id,
  );

  return completed(`tag-removed:${tagId}`);
};

// ── internal-note ───────────────────────────────────────────────────────────

const internalNoteHandler: ActionHandler = async (ctx, tx) => {
  const parsed = internalNoteActionSchema.parse(ctx.actionConfig);
  const { body, authorId } = parsed;

  // authorId is required (enforced by schema). Must be a valid workspace member.
  const membership = await tx.membership.findFirst({
    where: { userId: authorId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!membership) {
    return permanentFailure(`Author ${authorId} is not a member of workspace ${ctx.workspaceId}`);
  }

  const dedupeKey = `${ctx.executionId}:${ctx.actionIndex}`;

  await createAutomationInternalNote({
    ticketId: ctx.ticketId,
    workspaceId: ctx.workspaceId,
    authorId,
    body,
    dedupeKey,
    tx,
  });

  return completed('note-created');
};

// ── notification ────────────────────────────────────────────────────────────

const notificationHandler: ActionHandler = async (ctx, tx) => {
  const parsed = notificationActionSchema.parse(ctx.actionConfig);
  const { recipientId, title, body } = parsed;

  // Verify recipient workspace membership.
  const membership = await tx.membership.findFirst({
    where: { userId: recipientId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!membership) {
    return permanentFailure(`Recipient ${recipientId} is not a member of workspace ${ctx.workspaceId}`);
  }

  const dedupeKey = `${ctx.executionId}:${ctx.actionIndex}`;

  await createAutomationNotification({
    recipientId,
    workspaceId: ctx.workspaceId,
    ticketId: ctx.ticketId,
    title,
    body,
    dedupeKey,
    tx,
  });

  return completed('notification-created');
};

// ── helpers ─────────────────────────────────────────────────────────────────

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

// ── registry ────────────────────────────────────────────────────────────────

import type { AutomationActionType } from './schema';

/**
 * Maps each supported action type to its handler.
 */
export const ACTION_HANDLERS: Record<AutomationActionType, ActionHandler> = {
  assign: assignHandler,
  unassign: unassignHandler,
  'set-status': setStatusHandler,
  'set-priority': setPriorityHandler,
  'add-tag': addTagHandler,
  'remove-tag': removeTagHandler,
  'internal-note': internalNoteHandler,
  notification: notificationHandler,
};

export function getActionHandler(actionType: string): ActionHandler | undefined {
  return ACTION_HANDLERS[actionType as AutomationActionType];
}
