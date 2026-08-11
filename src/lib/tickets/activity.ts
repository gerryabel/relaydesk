import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import type { Prisma } from '@/generated/prisma';
import { TicketActivityType } from '@/generated/prisma';

export class TicketNotFoundError extends Error {
  constructor(message = 'Tiket tidak ditemukan.') {
    super(message);
    this.name = 'TicketNotFoundError';
  }
}

export type { TicketActivityType };

export type TicketActivityWithActor = {
  id: string;
  ticketId: string;
  actorId: string | null;
  type: TicketActivityType;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  actor: {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    image: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

export async function getTicketActivities(ticketId: string): Promise<TicketActivityWithActor[]> {
  const membership = await getCurrentMembership();

  const ticket = await prisma.ticket.findFirst({
    where: {
      id: ticketId,
      workspaceId: membership.workspaceId,
    },
    select: { id: true },
  });

  if (!ticket) {
    throw new TicketNotFoundError();
  }

  const activities = await prisma.ticketActivity.findMany({
    where: { ticketId: ticket.id },
    include: {
      actor: {
        select: {
          id: true,
          email: true,
          emailVerified: true,
          name: true,
          image: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return activities as TicketActivityWithActor[];
}
