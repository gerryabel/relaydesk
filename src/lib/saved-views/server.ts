import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import {
  createSavedViewSchema,
  updateSavedViewSchema,
  sanitizeFilterState,
  sanitizeSortState,
  sanitizeViewState,
  type CreateSavedViewInput,
  type UpdateSavedViewInput,
} from './schema';
import type { SavedView, SavedViewType } from '@/generated/prisma';

export class SavedViewNotFoundError extends Error {
  constructor(message = 'Saved view tidak ditemukan.') {
    super(message);
    this.name = 'SavedViewNotFoundError';
  }
}

export class SavedViewForbiddenError extends Error {
  constructor(message = 'Kamu tidak memiliki akses ke saved view ini.') {
    super(message);
    this.name = 'SavedViewForbiddenError';
  }
}

export class DuplicateSavedViewNameError extends Error {
  constructor(message = 'Nama saved view sudah digunakan.') {
    super(message);
    this.name = 'DuplicateSavedViewNameError';
  }
}

export type SavedViewListItem = {
  id: string;
  name: string;
  type: SavedViewType;
  createdAt: string;
  updatedAt: string;
};

export type SavedViewDetail = SavedViewListItem & {
  filterState: Record<string, unknown>;
  sortState: { field: string; direction: string };
  viewState: string;
};

function toDetail(row: SavedView): SavedViewDetail {
  return {
    id: row.id,
    name: row.name,
    type: row.type as SavedViewType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    filterState: sanitizeFilterState(row.filterState),
    sortState: sanitizeSortState(row.sortState),
    viewState: sanitizeViewState(row.viewState),
  };
}

function toList(row: SavedView): SavedViewListItem {
  return {
    id: row.id,
    name: row.name,
    type: row.type as SavedViewType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Lists all saved views owned by the current user in the current workspace.
 * Ownership is derived from the authenticated session — never from a client
 * field. Workspace isolation is enforced by scoping to membership.workspaceId.
 */
export async function listSavedViews(): Promise<SavedViewListItem[]> {
  const membership = await getCurrentMembership();

  const rows = await prisma.savedView.findMany({
    where: {
      workspaceId: membership.workspaceId,
      userId: membership.userId,
    },
    orderBy: { updatedAt: 'desc' },
  });

  return rows.map(toList);
}

/**
 * Returns a single saved view owned by the current user. Throws
 * SavedViewNotFoundError when the id does not exist, and
 * SavedViewForbiddenError when it belongs to another user or workspace.
 */
export async function getSavedView(id: string): Promise<SavedViewDetail> {
  const membership = await getCurrentMembership();

  const row = await prisma.savedView.findUnique({ where: { id } });

  if (!row || row.workspaceId !== membership.workspaceId || row.userId !== membership.userId) {
    throw row
      ? new SavedViewForbiddenError()
      : new SavedViewNotFoundError();
  }

  return toDetail(row);
}

/**
 * Creates a saved view for the current user. The workspace and user ids come
 * from the authenticated session. Duplicate names (per workspace+user) are
 * rejected.
 */
export async function createSavedView(input: CreateSavedViewInput): Promise<SavedViewDetail> {
  const parsed = createSavedViewSchema.parse(input);
  const membership = await getCurrentMembership();

  const existing = await prisma.savedView.findUnique({
    where: {
      workspaceId_userId_name: {
        workspaceId: membership.workspaceId,
        userId: membership.userId,
        name: parsed.name,
      },
    },
    select: { id: true },
  });

  if (existing) {
    throw new DuplicateSavedViewNameError();
  }

  const row = await prisma.savedView.create({
    data: {
      workspaceId: membership.workspaceId,
      userId: membership.userId,
      type: parsed.type,
      name: parsed.name,
      filterState: parsed.filterState,
      sortState: parsed.sortState,
      viewState: parsed.viewState,
    },
  });

  return toDetail(row);
}

/**
 * Updates a saved view. Ownership is verified server-side. A rename that
 * collides with another owned view is rejected.
 */
export async function updateSavedView(
  id: string,
  input: UpdateSavedViewInput,
): Promise<SavedViewDetail> {
  const parsed = updateSavedViewSchema.parse(input);
  const membership = await getCurrentMembership();

  const current = await prisma.savedView.findUnique({ where: { id } });

  if (!current || current.workspaceId !== membership.workspaceId || current.userId !== membership.userId) {
    throw current
      ? new SavedViewForbiddenError()
      : new SavedViewNotFoundError();
  }

  if (parsed.name && parsed.name !== current.name) {
    const clash = await prisma.savedView.findUnique({
      where: {
        workspaceId_userId_name: {
          workspaceId: membership.workspaceId,
          userId: membership.userId,
          name: parsed.name,
        },
      },
      select: { id: true },
    });

    if (clash) {
      throw new DuplicateSavedViewNameError();
    }
  }

  const row = await prisma.savedView.update({
    where: { id },
    data: {
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.type !== undefined ? { type: parsed.type } : {}),
      ...(parsed.filterState !== undefined ? { filterState: parsed.filterState } : {}),
      ...(parsed.sortState !== undefined ? { sortState: parsed.sortState } : {}),
      ...(parsed.viewState !== undefined ? { viewState: parsed.viewState } : {}),
    },
  });

  return toDetail(row);
}

/**
 * Deletes a saved view. Ownership is verified server-side.
 */
export async function deleteSavedView(id: string): Promise<{ id: string }> {
  const membership = await getCurrentMembership();

  const current = await prisma.savedView.findUnique({ where: { id } });

  if (!current || current.workspaceId !== membership.workspaceId || current.userId !== membership.userId) {
    throw current
      ? new SavedViewForbiddenError()
      : new SavedViewNotFoundError();
  }

  await prisma.savedView.delete({ where: { id } });

  return { id };
}
