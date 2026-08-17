import { z } from 'zod';
import type { TicketStatus } from '@/generated/prisma';
import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';

export const notificationTypeSchema = z.enum(['TICKET_ASSIGNED', 'TICKET_STATUS_CHANGED']);

export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type NotificationPaginationInput = z.infer<typeof notificationPaginationSchema>;

export type NotificationListItem = {
  id: string;
  userId: string;
  workspaceId: string;
  ticketId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ticket?: {
    id: string;
    title: string;
    status: TicketStatus;
  } | null;
};

export class NotificationNotFoundError extends Error {
  constructor(message = 'Notification not found') {
    super(message);
    this.name = 'NotificationNotFoundError';
  }
}

export async function createNotification(input: {
  userId: string;
  workspaceId: string;
  ticketId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
}): Promise<NotificationListItem> {
  const membership = await getCurrentMembership();

  if (membership.userId !== input.userId || membership.workspaceId !== input.workspaceId) {
    throw new Error('Notification recipient does not match current membership');
  }

  if (input.ticketId) {
    const ticket = await prisma.ticket.findFirst({
      where: { id: input.ticketId, workspaceId: membership.workspaceId },
      select: { id: true },
    });

    if (!ticket) {
      throw new Error('Related ticket not found in current workspace');
    }
  }

  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      ticketId: input.ticketId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
    },
    include: {
      ticket: {
        select: { id: true, title: true, status: true },
      },
    },
  });

  return notification as NotificationListItem;
}

export async function getNotifications(input: {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
} = {}): Promise<{ data: NotificationListItem[]; total: number; page: number; limit: number }> {
  const membership = await getCurrentMembership();
  const parsed = notificationPaginationSchema.parse(input);
  const { page, limit } = parsed;
  const total = await prisma.notification.count({
    where: {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      ...(input.unreadOnly ? { readAt: null } : {}),
    },
  });

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const normalizedPage = Math.min(page, totalPages);
  const skip = (normalizedPage - 1) * limit;

  const notifications = await prisma.notification.findMany({
    where: {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      ...(input.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
    include: {
      ticket: {
        select: { id: true, title: true, status: true },
      },
    },
  });

  return {
    data: notifications as NotificationListItem[],
    total,
    page: normalizedPage,
    limit,
  };
}

export async function getUnreadNotificationCount(): Promise<number> {
  const membership = await getCurrentMembership();

  return prisma.notification.count({
    where: {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      readAt: null,
    },
  });
}

export async function markNotificationAsRead(id: string): Promise<NotificationListItem> {
  const membership = await getCurrentMembership();

  const notification = await prisma.notification.findFirst({
    where: {
      id,
      userId: membership.userId,
      workspaceId: membership.workspaceId,
    },
    include: {
      ticket: {
        select: { id: true, title: true, status: true },
      },
    },
  });

  if (!notification) {
    throw new NotificationNotFoundError();
  }

  return prisma.notification
    .update({
      where: { id: notification.id },
      data: { readAt: new Date() },
      include: {
        ticket: {
          select: { id: true, title: true, status: true },
        },
      },
    })
    .then((item) => item as NotificationListItem);
}
