import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import {
  createNotification as schemaCreateNotification,
  getNotifications as schemaGetNotifications,
  getUnreadNotificationCount as schemaGetUnreadNotificationCount,
  markNotificationAsRead as schemaMarkNotificationAsRead,
  type NotificationListItem,
} from './schema';

type TransactionClient = Parameters<Parameters<typeof prisma['$transaction']>[0]>[0];

export async function createNotification(input: {
  userId: string;
  workspaceId: string;
  ticketId?: string | null;
  type: 'TICKET_ASSIGNED' | 'TICKET_STATUS_CHANGED';
  title: string;
  body: string;
}): Promise<NotificationListItem> {
  return schemaCreateNotification(input);
}

export async function getNotifications(input: {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
} = {}): Promise<{ data: NotificationListItem[]; total: number; page: number; limit: number }> {
  return schemaGetNotifications(input);
}

export async function getUnreadNotificationCount(): Promise<number> {
  return schemaGetUnreadNotificationCount();
}

export async function markNotificationAsRead(id: string): Promise<NotificationListItem> {
  return schemaMarkNotificationAsRead(id);
}

export async function createTicketAssignedNotification({
  actorId,
  ticketId,
  assigneeId,
  previousAssigneeId,
  workspaceId,
  tx = prisma,
}: {
  actorId: string;
  ticketId: string;
  assigneeId: string;
  previousAssigneeId: string | null;
  workspaceId: string;
  tx?: typeof prisma | TransactionClient;
}): Promise<void> {
  if (!assigneeId || previousAssigneeId === assigneeId || actorId === assigneeId) {
    return;
  }

  const membership = await getCurrentMembership();

  if (membership.workspaceId !== workspaceId) {
    return;
  }

  const assigneeMembership = await prisma.membership.findFirst({
    where: { userId: assigneeId, workspaceId },
    select: { id: true },
  });

  if (!assigneeMembership) {
    return;
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, workspaceId },
    select: { id: true, title: true },
  });

  if (!ticket) {
    return;
  }

  await tx.notification.create({
    data: {
      userId: assigneeId,
      workspaceId,
      ticketId,
      type: 'TICKET_ASSIGNED',
      title: 'Ticket assigned to you',
      body: `Ticket #${ticket.id} was assigned to you.`,
    },
  });
}

export async function createTicketStatusChangedNotification({
  actorId,
  ticketId,
  workspaceId,
  tx = prisma,
}: {
  actorId: string;
  ticketId: string;
  workspaceId: string;
  tx?: typeof prisma | TransactionClient;
}): Promise<void> {
  const membership = await getCurrentMembership();

  if (membership.workspaceId !== workspaceId) {
    return;
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, workspaceId },
    select: { id: true, title: true, status: true, assignedToId: true },
  });

  if (!ticket || !ticket.assignedToId || actorId === ticket.assignedToId) {
    return;
  }

  const statusLabel = ticket.status.replace('_', ' ');

  await tx.notification.create({
    data: {
      userId: ticket.assignedToId,
      workspaceId,
      ticketId,
      type: 'TICKET_STATUS_CHANGED',
      title: 'Ticket status changed',
      body: `Ticket #${ticket.id} changed to ${statusLabel}.`,
    },
  });
}
