import { prisma } from '@/lib/db/prisma';
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

  const [assigneeMembership, ticket] = await Promise.all([
    tx.membership.findFirst({
      where: { userId: assigneeId, workspaceId },
      select: { id: true },
    }),
    tx.ticket.findFirst({
      where: { id: ticketId, workspaceId },
      select: { id: true, title: true },
    }),
  ]);

  if (!assigneeMembership) {
    throw new Error(`Assignee ${assigneeId} is not in workspace ${workspaceId}`);
  }

  if (!ticket) {
    throw new Error(`Ticket ${ticketId} not found in workspace ${workspaceId}`);
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
  const ticket = await tx.ticket.findFirst({
    where: { id: ticketId, workspaceId },
    select: { id: true, title: true, status: true, assignedToId: true },
  });

  if (!ticket) {
    throw new Error(`Ticket ${ticketId} not found in workspace ${workspaceId}`);
  }

  if (!ticket.assignedToId || actorId === ticket.assignedToId) {
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
