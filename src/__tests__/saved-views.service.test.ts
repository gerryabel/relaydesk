import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import {
  listSavedViews,
  getSavedView,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  SavedViewNotFoundError,
  SavedViewForbiddenError,
  DuplicateSavedViewNameError,
} from '@/lib/saved-views/server';
import { getCurrentMembership, UnauthorizedError } from '@/lib/workspace/server';

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock('@/lib/workspace/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/server')>();
  return {
    ...actual,
    getCurrentMembership: vi.fn(),
  };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    savedView: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);
const mockedFindMany = vi.mocked(prisma.savedView.findMany);
const mockedFindUnique = vi.mocked(prisma.savedView.findUnique);
const mockedCreate = vi.mocked(prisma.savedView.create);
const mockedUpdate = vi.mocked(prisma.savedView.update);
const mockedDelete = vi.mocked(prisma.savedView.delete);

const fakeMembership = {
  id: 'membership-self',
  userId: 'user-123',
  workspaceId: 'workspace-123',
  role: 'owner' as const,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  workspace: {
    id: 'workspace-123',
    name: 'Workspace 123',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  },
};

function makeSavedView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sv-1',
    workspaceId: 'workspace-123',
    userId: 'user-123',
    type: 'tickets',
    name: 'My View',
    filterState: { status: 'open' },
    sortState: { field: 'createdAt', direction: 'desc' },
    viewState: 'my-open',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-02T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockedGetCurrentMembership.mockReset();
  mockedFindMany.mockReset();
  mockedFindUnique.mockReset();
  mockedCreate.mockReset();
  mockedUpdate.mockReset();
  mockedDelete.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('listSavedViews', () => {
  it('queries scoped to current workspace and user', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindMany.mockResolvedValueOnce([makeSavedView()] as never);

    const result = await listSavedViews();

    expect(mockedFindMany).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-123', userId: 'user-123' },
      orderBy: { updatedAt: 'desc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sv-1');
    expect(result[0].name).toBe('My View');
  });

  it('throws UnauthorizedError when no session', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    await expect(listSavedViews()).rejects.toThrow(UnauthorizedError);
  });
});

describe('getSavedView', () => {
  it('returns the saved view when owned by current user', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(makeSavedView() as never);

    const result = await getSavedView('sv-1');

    expect(result.id).toBe('sv-1');
    expect(result.name).toBe('My View');
    expect(result.filterState).toEqual({ status: 'open' });
  });

  it('throws SavedViewNotFoundError when not found', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(null);

    await expect(getSavedView('missing')).rejects.toThrow(SavedViewNotFoundError);
  });

  it('throws SavedViewForbiddenError when owned by another user', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(
      makeSavedView({ userId: 'user-OTHER' }) as never,
    );

    await expect(getSavedView('sv-1')).rejects.toThrow(SavedViewForbiddenError);
  });

  it('throws SavedViewForbiddenError when in another workspace', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(
      makeSavedView({ workspaceId: 'workspace-OTHER' }) as never,
    );

    await expect(getSavedView('sv-1')).rejects.toThrow(SavedViewForbiddenError);
  });
});

describe('createSavedView', () => {
  it('creates a saved view with session-derived workspace/user ids', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(null);
    mockedCreate.mockResolvedValueOnce(makeSavedView({ name: 'New View' }) as never);

    const result = await createSavedView({
      name: 'New View',
      type: 'tickets',
      filterState: { status: 'open' },
      sortState: { field: 'priority', direction: 'asc' },
      viewState: 'my-open',
    });

    expect(mockedCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 'workspace-123',
        userId: 'user-123',
        name: 'New View',
        type: 'tickets',
      }),
    });
    expect(result.name).toBe('New View');
  });

  it('rejects duplicate name within workspace+user', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce({ id: 'sv-existing' } as never);

    await expect(
      createSavedView({
        name: 'Duplicate',
        type: 'tickets',
        filterState: {},
        sortState: { field: 'createdAt', direction: 'desc' },
        viewState: 'my-open',
      }),
    ).rejects.toThrow(DuplicateSavedViewNameError);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('never trusts a client-supplied workspace/user id', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(null);
    mockedCreate.mockResolvedValueOnce(makeSavedView() as never);

    await createSavedView({
      name: 'Safe',
      type: 'tickets',
      filterState: {},
      sortState: { field: 'createdAt', direction: 'desc' },
      viewState: 'my-open',
    });

    expect(mockedCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 'workspace-123',
        userId: 'user-123',
      }),
    });
  });
});

describe('updateSavedView', () => {
  it('updates the saved view when owned', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(makeSavedView() as never);
    mockedUpdate.mockResolvedValueOnce(makeSavedView({ name: 'Renamed' }) as never);

    const result = await updateSavedView('sv-1', { name: 'Renamed' });

    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: 'sv-1' },
      data: { name: 'Renamed' },
    });
    expect(result.name).toBe('Renamed');
  });

  it('throws SavedViewNotFoundError when not found', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(null);

    await expect(updateSavedView('missing', { name: 'X' })).rejects.toThrow(
      SavedViewNotFoundError,
    );
  });

  it('throws SavedViewForbiddenError when not owned', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(
      makeSavedView({ userId: 'user-OTHER' }) as never,
    );

    await expect(updateSavedView('sv-1', { name: 'X' })).rejects.toThrow(
      SavedViewForbiddenError,
    );
  });

  it('rejects rename that collides with another owned view', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique
      .mockResolvedValueOnce(makeSavedView() as never)
      .mockResolvedValueOnce({ id: 'sv-other' } as never);

    await expect(updateSavedView('sv-1', { name: 'Taken' })).rejects.toThrow(
      DuplicateSavedViewNameError,
    );
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('allows keeping the same name without collision', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(makeSavedView({ name: 'Same' }) as never);
    mockedUpdate.mockResolvedValueOnce(makeSavedView({ name: 'Same' }) as never);

    const result = await updateSavedView('sv-1', { name: 'Same' });

    expect(result.name).toBe('Same');
  });
});

describe('deleteSavedView', () => {
  it('deletes the saved view when owned', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(makeSavedView() as never);

    const result = await deleteSavedView('sv-1');

    expect(mockedDelete).toHaveBeenCalledWith({ where: { id: 'sv-1' } });
    expect(result.id).toBe('sv-1');
  });

  it('throws SavedViewNotFoundError when not found', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(null);

    await expect(deleteSavedView('missing')).rejects.toThrow(SavedViewNotFoundError);
  });

  it('throws SavedViewForbiddenError when not owned', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeMembership as never);
    mockedFindUnique.mockResolvedValueOnce(
      makeSavedView({ userId: 'user-OTHER' }) as never,
    );

    await expect(deleteSavedView('sv-1')).rejects.toThrow(SavedViewForbiddenError);
  });
});

describe('saved view domain error classes', () => {
  it('SavedViewNotFoundError has correct name', () => {
    expect(new SavedViewNotFoundError().name).toBe('SavedViewNotFoundError');
  });

  it('SavedViewForbiddenError has correct name', () => {
    expect(new SavedViewForbiddenError().name).toBe('SavedViewForbiddenError');
  });

  it('DuplicateSavedViewNameError has correct name', () => {
    expect(new DuplicateSavedViewNameError().name).toBe('DuplicateSavedViewNameError');
  });
});
