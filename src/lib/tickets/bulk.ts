import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import { assertTransitionAllowed } from '@/lib/tickets/workflow';
import {
  bulkActionSchema,
  bulkAssignPayloadSchema,
  bulkStatusPayloadSchema,
  bulkPriorityPayloadSchema,
  bulkTagPayloadSchema,
  type BulkActionInput,
} from '@/lib/tickets/schema';
import {
  createTicketAssignedNotification,
  createTicketStatusChangedNotification,
} from '@/lib/notifications/server';
import type { TicketWithCreator } from '@/lib/tickets/server';

export class BulkTicketIdsRequiredError extends Error {
  constructor(message = 'Pilih minimal satu tiket.') {
    super(message);
    this.name = 'BulkTicketIdsRequiredError';
  }
}

export class BulkTicketLimitExceededError extends Error {
  constructor(message = 'Maksimal 100 tiket.') {
    super(message);
    this.name = 'BulkTicketLimitExceededError';
  }
}

export class BulkDuplicateTicketIdsError extends Error {
  constructor(message = 'ID tiket tidak boleh duplikat.') {
    super(message);
    this.name = 'BulkDuplicateTicketIdsError';
  }
}

export class BulkActionNotSupportedError extends Error {
  constructor(message = 'Aksi tidak didukung.') {
    super(message);
    this.name = 'BulkActionNotSupportedError';
  }
}

export class BulkAssigneeNotInWorkspaceError extends Error {
  constructor(message = 'Assignee bukan member workspace ini.') {
    super(message);
    this.name = 'BulkAssigneeNotInWorkspaceError';
  }
}

export class BulkInvalidTransitionError extends Error {
  constructor(message = 'Satu atau lebih transisi status tidak diizinkan.') {
    super(message);
    this.name = 'BulkInvalidTransitionError';
  }
}

export class BulkTagNotFoundError extends Error {
  constructor(message = 'Tag tidak ditemukan.') {
    super(message);
    this.name = 'BulkTagNotFoundError';
  }
}

export class BulkTagNotInWorkspaceError extends Error {
  constructor(message = 'Tag bukan bagian dari workspace ini.') {
    super(message);
    this.name = 'BulkTagNotInWorkspaceError';
  }
}

export type BulkUpdateResult = {
  updatedCount: number;
  noOpCount: number;
};

const MAX_BULK_TICKETS = 100;

export function normalizeBulkTicketIds(ticketIds: string[]) {
  const trimmed = ticketIds.map((ticketId) => ticketId.trim()).filter((ticketId) => Boolean(ticketId));

  if (trimmed.length === 0) {
    throw new BulkTicketIdsRequiredError();
  }

  if (trimmed.length > MAX_BULK_TICKETS) {
    throw new BulkTicketLimitExceededError();
  }

  const uniqueIds = [...new Set(trimmed)];
  if (uniqueIds.length !== trimmed.length) {
    throw new BulkDuplicateTicketIdsError();
  }

  return uniqueIds;
}

export function assertBulkActionAllowed(action: unknown): asserts action is BulkActionInput['action'] {
  const parsed = bulkActionSchema.pick({ action: true }).safeParse({ action });

  if (!parsed.success) {
    throw new BulkActionNotSupportedError();
  }
}

function assertBulkAssignPayload(value: unknown) {
  const parsed = bulkAssignPayloadSchema.safeParse({ assigneeId: value });

  if (!parsed.success) {
    throw new BulkAssigneeNotInWorkspaceError(parsed.error.issues[0]?.message ?? 'Invalid assignee');
  }

  return parsed.data;
}

function assertBulkStatusPayload(value: unknown) {
  const parsed = bulkStatusPayloadSchema.safeParse({ status: value });

  if (!parsed.success) {
    throw new BulkInvalidTransitionError(parsed.error.issues[0]?.message ?? 'Invalid status');
  }

  return parsed.data;
}

function assertBulkPriorityPayload(value: unknown) {
  const parsed = bulkPriorityPayloadSchema.safeParse({ priority: value });

  if (!parsed.success) {
    throw new BulkActionNotSupportedError(parsed.error.issues[0]?.message ?? 'Invalid priority');
  }

  return parsed.data;
}

function assertBulkTagPayload(value: unknown) {
  const parsed = bulkTagPayloadSchema.safeParse({ tagId: value });

  if (!parsed.success) {
    throw new BulkTagNotFoundError(parsed.error.issues[0]?.message ?? 'Invalid tag');
  }

  return parsed.data;
}

async function assertAssigneeInWorkspace(assigneeId: string, workspaceId: string) {
  const assigneeMembership = await prisma.membership.findFirst({
    where: { userId: assigneeId, workspaceId },
    select: { id: true },
  });

  if (!assigneeMembership) {
    throw new BulkAssigneeNotInWorkspaceError();
  }
}

async function assertTagInWorkspace(tagId: string, workspaceId: string) {
  const tag = await prisma.tag.findFirst({
    where: { id: tagId },
    select: { id: true, workspaceId: true },
  });

  if (!tag) {
    throw new BulkTagNotFoundError();
  }

  if (tag.workspaceId !== workspaceId) {
    throw new BulkTagNotInWorkspaceError();
  }
}

async function loadBulkSelection(ticketIds: string[], workspaceId: string) {
  const tickets = await prisma.ticket.findMany({
    where: {
      id: { in: ticketIds },
      workspaceId,
    },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      priority: true,
      assignedToId: true,
      resolvedAt: true,
      title: true,
    },
  });

  if (tickets.length !== ticketIds.length) {
    throw new BulkTicketIdsRequiredError('Satu atau lebih tiket tidak ditemukan.');
  }

  return tickets as TicketWithCreator[];
}

async function applyBulkAssignment(tx: typeof prisma, tickets: TicketWithCreator[], membership: { userId: string; workspaceId: string }, assigneeId: string) {
  let updatedCount = 0;
  let noOpCount = 0;

  for (const ticket of tickets) {
    if (ticket.assignedToId === assigneeId) {
      noOpCount += 1;
      continue;
    }

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: { assignedToId: assigneeId },
      include: { createdBy: true, assignedTo: true, customer: true },
    });

    await tx.ticketActivity.create({
      data: {
        ticketId: updated.id,
        actorId: membership.userId,
        type: 'TICKET_ASSIGNED',
        metadata: { from: ticket.assignedToId, to: assigneeId },
      },
    });

    if (updated.assignedToId !== membership.userId) {
      await createTicketAssignedNotification({
        actorId: membership.userId,
        ticketId: updated.id,
        assigneeId: updated.assignedToId ?? '',
        previousAssigneeId: ticket.assignedToId,
        workspaceId: membership.workspaceId,
        tx,
      });
    }

    updatedCount += 1;
  }

  return { updatedCount, noOpCount };
}

async function applyBulkStatusChange(tx: typeof prisma, tickets: TicketWithCreator[], membership: { userId: string; workspaceId: string }, nextStatus: string) {
  let updatedCount = 0;
  let noOpCount = 0;

  for (const ticket of tickets) {
    if (ticket.status !== nextStatus) {
      assertTransitionAllowed(ticket.status, nextStatus);
    }

    if (ticket.status === nextStatus) {
      noOpCount += 1;
      continue;
    }

    const data: Record<string, unknown> = { status: nextStatus };

    if (nextStatus === 'resolved' && !ticket.resolvedAt) {
      data.resolvedAt = new Date();
    }

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data,
      include: { createdBy: true, assignedTo: true, customer: true },
    });

    await tx.ticketActivity.create({
      data: {
        ticketId: updated.id,
        actorId: membership.userId,
        type: 'STATUS_CHANGED',
        metadata: { from: ticket.status, to: nextStatus },
      },
    });

    if (updated.assignedToId && updated.assignedToId !== membership.userId) {
      await createTicketStatusChangedNotification({
        actorId: membership.userId,
        ticketId: updated.id,
        workspaceId: membership.workspaceId,
        tx,
      });
    }

    updatedCount += 1;
  }

  return { updatedCount, noOpCount };
}

async function applyBulkPriorityChange(tx: typeof prisma, tickets: TicketWithCreator[], membership: { userId: string; workspaceId: string }, nextPriority: string) {
  let updatedCount = 0;
  let noOpCount = 0;

  for (const ticket of tickets) {
    if (ticket.priority === nextPriority) {
      noOpCount += 1;
      continue;
    }

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: { priority: nextPriority },
      include: { createdBy: true, assignedTo: true, customer: true },
    });

    await tx.ticketActivity.create({
      data: {
        ticketId: updated.id,
        actorId: membership.userId,
        type: 'PRIORITY_CHANGED',
        metadata: { from: ticket.priority, to: nextPriority },
      },
    });

    updatedCount += 1;
  }

  return { updatedCount, noOpCount };
}

async function applyBulkAddTag(tx: typeof prisma, tickets: TicketWithCreator[], membership: { userId: string; workspaceId: string }, tagId: string) {
  let updatedCount = 0;
  let noOpCount = 0;

  for (const ticket of tickets) {
    const existing = await tx.ticketTag.findFirst({
      where: { ticketId: ticket.id, tagId },
    });

    if (existing) {
      noOpCount += 1;
      continue;
    }

    await tx.ticketTag.create({
      data: { ticketId: ticket.id, tagId },
    });

    await tx.ticketActivity.create({
      data: {
        ticketId: ticket.id,
        actorId: membership.userId,
        type: 'TAG_ADDED',
        metadata: { tagId },
      },
    });

    updatedCount += 1;
  }

  return { updatedCount, noOpCount };
}

async function applyBulkRemoveTag(tx: typeof prisma, tickets: TicketWithCreator[], membership: { userId: string; workspaceId: string }, tagId: string) {
  let updatedCount = 0;
  let noOpCount = 0;

  for (const ticket of tickets) {
    const existing = await tx.ticketTag.findFirst({
      where: { ticketId: ticket.id, tagId },
    });

    if (!existing) {
      noOpCount += 1;
      continue;
    }

    await tx.ticketTag.delete({
      where: {
        ticketId_tagId: {
          ticketId: ticket.id,
          tagId,
        },
      },
    });

    await tx.ticketActivity.create({
      data: {
        ticketId: ticket.id,
        actorId: membership.userId,
        type: 'TAG_REMOVED',
        metadata: { tagId },
      },
    });

    updatedCount += 1;
  }

  return { updatedCount, noOpCount };
}

export async function bulkUpdateTickets(payload: unknown): Promise<BulkUpdateResult> {
  const parsed = bulkActionSchema.parse(payload);
  const ticketIds = normalizeBulkTicketIds(parsed.ticketIds);
  const uniqueTicketIds = ticketIds;
  const membership = await getCurrentMembership();

  assertBulkActionAllowed(parsed.action);

  if (parsed.action === 'assign') {
    assertBulkAssignPayload(parsed.value);
    await assertAssigneeInWorkspace(parsed.value.assigneeId as string, membership.workspaceId);
  }

  if (parsed.action === 'status') {
    assertBulkStatusPayload(parsed.value);
  }

  if (parsed.action === 'priority') {
    assertBulkPriorityPayload(parsed.value);
  }

  if (parsed.action === 'add_tag' || parsed.action === 'remove_tag') {
    assertBulkTagPayload(parsed.value);
    await assertTagInWorkspace(parsed.value.tagId as string, membership.workspaceId);
  }

  const tickets = await loadBulkSelection(uniqueTicketIds, membership.workspaceId);

  return prisma.$transaction(async (tx) => {
    if (parsed.action === 'assign') {
      return applyBulkAssignment(tx, tickets, membership, parsed.value.assigneeId as string);
    }

    if (parsed.action === 'status') {
      return applyBulkStatusChange(tx, tickets, membership, parsed.value.status as string);
    }

    if (parsed.action === 'priority') {
      return applyBulkPriorityChange(tx, tickets, membership, parsed.value.priority as string);
    }

    if (parsed.action === 'add_tag') {
      return applyBulkAddTag(tx, tickets, membership, parsed.value.tagId as string);
    }

    if (parsed.action === 'remove_tag') {
      return applyBulkRemoveTag(tx, tickets, membership, parsed.value.tagId as string);
    }

    throw new BulkActionNotSupportedError();
  });
}
