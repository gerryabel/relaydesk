import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import { createTagSchema, updateTagSchema, type CreateTagInput, type UpdateTagInput } from '@/lib/tags/schema';
import { TicketNotFoundError as TicketsTicketNotFoundError } from '@/lib/tickets/server';

export const TicketNotFoundError = TicketsTicketNotFoundError;

export class TagNotFoundError extends Error {
  constructor(message = 'Tag tidak ditemukan.') {
    super(message);
    this.name = 'TagNotFoundError';
  }
}

export class DuplicateTagError extends Error {
  constructor(message = 'Tag dengan nama yang sama sudah ada di workspace ini.') {
    super(message);
    this.name = 'DuplicateTagError';
  }
}

export class TagNotInWorkspaceError extends Error {
  constructor(message = 'Tag bukan bagian dari workspace ini.') {
    super(message);
    this.name = 'TagNotInWorkspaceError';
  }
}

export class TicketNotInWorkspaceError extends Error {
  constructor(message = 'Tiket bukan bagian dari workspace ini.') {
    super(message);
    this.name = 'TicketNotInWorkspaceError';
  }
}

export class TicketTagAlreadyExistsError extends Error {
  constructor(message = 'Tiket sudah memiliki tag ini.') {
    super(message);
    this.name = 'TicketTagAlreadyExistsError';
  }
}

export class TicketTagNotFoundError extends Error {
  constructor(message = 'Tag tidak ditemukan pada tiket ini.') {
    super(message);
    this.name = 'TicketTagNotFoundError';
  }
}

function normalizeTagName(name: string) {
  return name.trim().toLowerCase();
}

function isUniqueTagError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const known = error as Error & { code?: string; meta?: { target?: string[]; modelName?: string } };
  const hasTagModel = known.meta?.modelName === 'Tag';
  const targetIncludesNormalizedName = Array.isArray(known.meta?.target) && known.meta.target.includes('workspaceId_normalizedName');
  const messageMentionsNormalizedName =
    typeof known.message === 'string' &&
    (known.message.includes('workspaceId_normalizedName') || known.message.includes('Tag_workspaceId_normalizedName_key'));

  return known.code === 'P2002' && (hasTagModel || targetIncludesNormalizedName || messageMentionsNormalizedName);
}

export async function createTag(input: CreateTagInput) {
  const parsed = createTagSchema.parse(input);
  const membership = await getCurrentMembership();
  const normalizedName = normalizeTagName(parsed.name);

  try {
    const tag = await prisma.tag.create({
      data: {
        workspaceId: membership.workspaceId,
        name: parsed.name.trim(),
        normalizedName,
      },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        normalizedName: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return tag;
  } catch (error) {
    if (isUniqueTagError(error)) {
      throw new DuplicateTagError();
    }

    throw error;
  }
}

export async function getTags() {
  const membership = await getCurrentMembership();

  return prisma.tag.findMany({
    where: { workspaceId: membership.workspaceId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      normalizedName: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getTagById(id: string) {
  const membership = await getCurrentMembership();

  const tag = await prisma.tag.findFirst({
    where: { id, workspaceId: membership.workspaceId },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      normalizedName: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!tag) {
    throw new TagNotFoundError();
  }

  return tag;
}

export async function updateTag(id: string, input: UpdateTagInput) {
  const membership = await getCurrentMembership();
  const parsed = updateTagSchema.parse(input);

  const existing = await prisma.tag.findFirst({
    where: { id, workspaceId: membership.workspaceId },
    select: { id: true, name: true, workspaceId: true },
  });

  if (!existing) {
    throw new TagNotFoundError();
  }

  if (!parsed.name) {
    return existing;
  }

  const trimmedName = parsed.name.trim();
  const normalizedName = normalizeTagName(trimmedName);

  try {
    return await prisma.tag.update({
      where: { id: existing.id },
      data: { name: trimmedName, normalizedName },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        normalizedName: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  } catch (error) {
    if (isUniqueTagError(error)) {
      throw new DuplicateTagError();
    }

    throw error;
  }
}

export async function deleteTag(id: string) {
  const membership = await getCurrentMembership();

  const tag = await prisma.tag.findFirst({
    where: { id, workspaceId: membership.workspaceId },
    select: { id: true },
  });

  if (!tag) {
    throw new TagNotFoundError();
  }

  try {
    await prisma.tag.delete({
      where: { id: tag.id },
    });
  } catch (error) {
    if (isUniqueTagError(error)) {
      throw new DuplicateTagError();
    }

    throw error;
  }
}

export async function getTicketTags(ticketId: string) {
  const membership = await getCurrentMembership();

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, workspaceId: membership.workspaceId },
    select: { id: true },
  });

  if (!ticket) {
    throw new TicketNotFoundError();
  }

  const tags = await prisma.ticketTag.findMany({
    where: { ticketId: ticket.id },
    include: {
      tag: {
        select: {
          id: true,
          workspaceId: true,
          name: true,
          normalizedName: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  return tags.map((ticketTag) => ticketTag.tag);
}

export async function addTagToTicket(ticketId: string, tagId: string) {
  const membership = await getCurrentMembership();

  const [ticket, tag] = await Promise.all([
    prisma.ticket.findFirst({
      where: { id: ticketId, workspaceId: membership.workspaceId },
      select: { id: true, workspaceId: true },
    }),
    prisma.tag.findFirst({
      where: { id: tagId },
      select: { id: true, workspaceId: true, name: true },
    }),
  ]);

  if (!ticket) {
    throw new TicketNotFoundError();
  }

  if (!tag) {
    throw new TagNotFoundError();
  }

  if (tag.workspaceId !== ticket.workspaceId) {
    throw new TicketNotInWorkspaceError('Tiket dan tag harus berada di workspace yang sama.');
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.ticketTag.create({
        data: {
          ticketId: ticket.id,
          tagId: tag.id,
        },
      });

      await tx.ticketActivity.create({
        data: {
          ticketId: ticket.id,
          actorId: membership.userId,
          type: 'TAG_ADDED',
          metadata: { tagId: tag.id, tagName: tag.name },
        },
      });
    });
  } catch (error) {
    if (isUniqueTicketTagError(error)) {
      throw new TicketTagAlreadyExistsError();
    }

    throw error;
  }
}

export async function removeTagFromTicket(ticketId: string, tagId: string) {
  const membership = await getCurrentMembership();

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, workspaceId: membership.workspaceId },
    select: { id: true, workspaceId: true },
  });

  if (!ticket) {
    throw new TicketNotFoundError();
  }

  const ticketTag = await prisma.ticketTag.findFirst({
    where: { ticketId: ticket.id, tagId },
    include: { tag: { select: { id: true, name: true, workspaceId: true } } },
  });

  if (!ticketTag) {
    throw new TicketTagNotFoundError();
  }

  const tag = ticketTag.tag;

  if (tag.workspaceId !== ticket.workspaceId) {
    throw new TicketNotInWorkspaceError('Tiket dan tag harus berada di workspace yang sama.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.ticketTag.delete({
      where: {
        ticketId_tagId: {
          ticketId: ticket.id,
          tagId: tag.id,
        },
      },
    });

    await tx.ticketActivity.create({
      data: {
        ticketId: ticket.id,
        actorId: membership.userId,
        type: 'TAG_REMOVED',
        metadata: { tagId: tag.id, tagName: tag.name },
      },
    });
  });
}

function isUniqueTicketTagError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const known = error as Error & { code?: string; meta?: { target?: string[]; modelName?: string } };
  const hasTicketTagModel = known.meta?.modelName === 'TicketTag';
  const targetIncludesComposite = Array.isArray(known.meta?.target) && known.meta.target.includes('ticketId_tagId');
  const messageMentionsComposite =
    typeof known.message === 'string' && known.message.includes('ticketId_tagId');

  return known.code === 'P2002' && (hasTicketTagModel || targetIncludesComposite || messageMentionsComposite);
}
