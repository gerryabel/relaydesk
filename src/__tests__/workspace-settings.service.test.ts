import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import {
  getWorkspaceSettings,
  updateWorkspaceName,
  MAX_WORKSPACE_NAME_LENGTH,
} from '@/lib/workspace/settings';
import {
  assertWorkspaceOwner,
  getCurrentMembership,
  ForbiddenError,
  UnauthorizedError,
} from '@/lib/workspace/server';

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock('@/lib/workspace/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/server')>();
  return {
    ...actual,
    getCurrentMembership: vi.fn(),
    assertWorkspaceOwner: vi.fn(),
  };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspace: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);
const mockedAssertWorkspaceOwner = vi.mocked(assertWorkspaceOwner);
const mockedFindUnique = vi.mocked(prisma.workspace.findUnique);
const mockedUpdate = vi.mocked(prisma.workspace.update);

const fakeSessionMembership = {
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

beforeEach(() => {
  vi.restoreAllMocks();
  mockedGetCurrentMembership.mockReset();
  mockedAssertWorkspaceOwner.mockReset();
  mockedFindUnique.mockReset();
  mockedUpdate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getWorkspaceSettings', () => {
  it('returns the current workspace settings scoped to membership', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedFindUnique.mockResolvedValueOnce({
      id: 'workspace-123',
      name: 'Workspace 123',
    } as never);

    const result = await getWorkspaceSettings();

    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: 'workspace-123' },
      select: { id: true, name: true },
    });
    expect(result).toEqual({ id: 'workspace-123', name: 'Workspace 123' });
  });

  it('never reads a client-supplied workspace id', async () => {
    mockedGetCurrentMembership.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedFindUnique.mockResolvedValueOnce({
      id: 'workspace-123',
      name: 'Workspace 123',
    } as never);

    await getWorkspaceSettings();

    expect(mockedFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'workspace-123' },
      }),
    );
  });

  it('throws UnauthorizedError when no session', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    await expect(getWorkspaceSettings()).rejects.toThrow(UnauthorizedError);
  });

  it('throws ForbiddenError when no membership', async () => {
    mockedGetCurrentMembership.mockRejectedValueOnce(
      new ForbiddenError('No workspace membership found'),
    );

    await expect(getWorkspaceSettings()).rejects.toThrow(ForbiddenError);
  });
});

describe('updateWorkspaceName authorization', () => {
  it('rejects unauthenticated mutation', async () => {
    mockedAssertWorkspaceOwner.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    await expect(updateWorkspaceName({ name: 'New Name' })).rejects.toThrow(
      UnauthorizedError,
    );
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('rejects non-owner mutation', async () => {
    mockedAssertWorkspaceOwner.mockRejectedValueOnce(
      new ForbiddenError('Only workspace owners can perform this action.'),
    );

    await expect(updateWorkspaceName({ name: 'New Name' })).rejects.toThrow(ForbiddenError);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('allows owner mutation', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedUpdate.mockResolvedValueOnce({
      id: 'workspace-123',
      name: 'New Name',
    } as never);

    const result = await updateWorkspaceName({ name: 'New Name' });

    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: 'workspace-123' },
      data: { name: 'New Name' },
      select: { id: true, name: true },
    });
    expect(result).toEqual({ id: 'workspace-123', name: 'New Name' });
  });

  it('mutates the authenticated user workspace, not a client id', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedUpdate.mockResolvedValueOnce({
      id: 'workspace-123',
      name: 'New Name',
    } as never);

    await updateWorkspaceName({ name: 'New Name' });

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'workspace-123' },
      }),
    );
  });
});

describe('updateWorkspaceName validation', () => {
  it('persists the trimmed value', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedUpdate.mockResolvedValueOnce({
      id: 'workspace-123',
      name: 'Trimmed Name',
    } as never);

    const result = await updateWorkspaceName({ name: '  Trimmed Name  ' });

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'Trimmed Name' },
      }),
    );
    expect(result.name).toBe('Trimmed Name');
  });

  it('rejects whitespace-only input', async () => {
    await expect(updateWorkspaceName({ name: '     ' })).rejects.toThrow(
      'Workspace name cannot be empty',
    );
    expect(mockedAssertWorkspaceOwner).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('rejects empty input', async () => {
    await expect(updateWorkspaceName({ name: '' })).rejects.toThrow();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('rejects non-string input', async () => {
    await expect(updateWorkspaceName({ name: 123 as unknown as string })).rejects.toThrow();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('rejects over-max-length input', async () => {
    const tooLong = 'a'.repeat(MAX_WORKSPACE_NAME_LENGTH + 1);

    await expect(updateWorkspaceName({ name: tooLong })).rejects.toThrow(
      `Workspace name cannot exceed ${MAX_WORKSPACE_NAME_LENGTH} characters`,
    );
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('accepts a name exactly at the max length', async () => {
    mockedAssertWorkspaceOwner.mockResolvedValueOnce(fakeSessionMembership as never);
    mockedUpdate.mockResolvedValueOnce({
      id: 'workspace-123',
      name: 'a'.repeat(MAX_WORKSPACE_NAME_LENGTH),
    } as never);

    const result = await updateWorkspaceName({
      name: 'a'.repeat(MAX_WORKSPACE_NAME_LENGTH),
    });

    expect(result.name).toBe('a'.repeat(MAX_WORKSPACE_NAME_LENGTH));
  });

  it('validates before invoking authorization', async () => {
    await expect(updateWorkspaceName({ name: '' })).rejects.toThrow();
    expect(mockedAssertWorkspaceOwner).not.toHaveBeenCalled();
  });
});
