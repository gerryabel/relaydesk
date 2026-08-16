import { describe, it, expect, vi, afterEach } from 'vitest';
import { prisma as sharedPrisma } from '@/lib/db/prisma';
import {
  createTag,
  getTags,
  getTagById,
  updateTag,
  deleteTag,
  DuplicateTagError,
  TagNotFoundError,
} from '@/lib/tags/server';
import { getCurrentMembership } from '@/lib/workspace/server';

vi.mock('@/lib/workspace/server', () => ({
  getCurrentMembership: vi.fn(),
}));

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);

afterEach(() => {
  vi.resetAllMocks();
});

const fakeMembership = {
  userId: 'user-123',
  workspaceId: 'workspace-1',
  workspace: {
    id: 'workspace-1',
    name: 'Workspace 1',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

describe('tag services', () => {
  it('createTag trims input and creates a tag', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    const createSpy = vi.spyOn(sharedPrisma.tag, 'create').mockResolvedValue({
      id: 'tag-1',
      workspaceId: 'workspace-1',
      name: 'Billing',
      normalizedName: 'billing',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const tag = await createTag({ name: ' Billing ' });
    expect(tag).toEqual(
      expect.objectContaining({
        id: 'tag-1',
        workspaceId: 'workspace-1',
        name: 'Billing',
        normalizedName: 'billing',
      }),
    );

    createSpy.mockRestore();
  });

  it('createTag rejects empty name', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    await expect(createTag({ name: '   ' })).rejects.toThrow();
  });

  it('createTag rejects name longer than 50 characters', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    await expect(createTag({ name: 'a'.repeat(51) })).rejects.toThrow();
  });

  it('createTag throws DuplicateTagError on case-insensitive conflict', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    const uniqueError = new Error('P2002 workspaceId_normalizedName') as Error & { code?: string; meta?: { target?: string[]; modelName?: string } };
    uniqueError.code = 'P2002';
    uniqueError.meta = { target: ['workspaceId_normalizedName'], modelName: 'Tag' };

    const createSpy = vi.spyOn(sharedPrisma.tag, 'create').mockRejectedValueOnce(uniqueError);

    try {
      await expect(createTag({ name: 'Billing' })).rejects.toThrow(DuplicateTagError);
    } finally {
      createSpy.mockRestore();
    }
  });

  it('getTags returns workspace tags ordered by name', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    const findManySpy = vi.spyOn(sharedPrisma.tag, 'findMany').mockResolvedValue([
      {
        id: 'tag-1',
        workspaceId: 'workspace-1',
        name: 'Billing',
        normalizedName: 'billing',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    const tags = await getTags();
    expect(tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workspaceId: 'workspace-1', name: 'Billing' }),
      ]),
    );

    findManySpy.mockRestore();
  });

  it('updateTag renames a tag and maintains normalizedName', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    const findFirstSpy = vi.spyOn(sharedPrisma.tag, 'findFirst').mockResolvedValue({
      id: 'tag-1',
      workspaceId: 'workspace-1',
      name: 'Billing',
      normalizedName: 'billing',
    } as never);
    const updateSpy = vi.spyOn(sharedPrisma.tag, 'update').mockResolvedValue({
      id: 'tag-1',
      workspaceId: 'workspace-1',
      name: 'Billing Updated',
      normalizedName: 'billing updated',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const tag = await updateTag('tag-1', { name: 'Billing Updated' });
    expect(tag).toEqual(
      expect.objectContaining({
        id: 'tag-1',
        workspaceId: 'workspace-1',
        name: 'Billing Updated',
        normalizedName: 'billing updated',
      }),
    );

    findFirstSpy.mockRestore();
    updateSpy.mockRestore();
  });

  it('updateTag returns existing tag when name is not provided', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    const findFirstSpy = vi.spyOn(sharedPrisma.tag, 'findFirst').mockResolvedValue({
      id: 'tag-1',
      workspaceId: 'workspace-1',
      name: 'Billing',
      normalizedName: 'billing',
    } as never);

    const tag = await updateTag('tag-1', {});
    expect(tag).toEqual(
      expect.objectContaining({
        id: 'tag-1',
        workspaceId: 'workspace-1',
        name: 'Billing',
        normalizedName: 'billing',
      }),
    );

    findFirstSpy.mockRestore();
  });

  it('deleteTag removes tag by id', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    const findFirstSpy = vi.spyOn(sharedPrisma.tag, 'findFirst').mockResolvedValue({
      id: 'tag-1',
      workspaceId: 'workspace-1',
    } as never);
    const deleteSpy = vi.spyOn(sharedPrisma.tag, 'delete').mockResolvedValue({
      id: 'tag-1',
      workspaceId: 'workspace-1',
      name: 'Billing',
      normalizedName: 'billing',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await expect(deleteTag('tag-1')).resolves.toBeUndefined();

    findFirstSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  it('deleteTag throws TagNotFoundError when tag is missing', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    const findFirstSpy = vi.spyOn(sharedPrisma.tag, 'findFirst').mockResolvedValue(null as never);

    await expect(deleteTag('missing')).rejects.toThrow(TagNotFoundError);

    findFirstSpy.mockRestore();
  });

  it('getTagById throws TagNotFoundError for missing tag', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    const findFirstSpy = vi.spyOn(sharedPrisma.tag, 'findFirst').mockResolvedValue(null as never);

    await expect(getTagById('missing')).rejects.toThrow(TagNotFoundError);

    findFirstSpy.mockRestore();
  });

  it('getTagById enforces workspace isolation', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    const findFirstSpy = vi.spyOn(sharedPrisma.tag, 'findFirst').mockResolvedValue(null as never);

    await expect(getTagById('tag-other-workspace')).rejects.toThrow(TagNotFoundError);

    findFirstSpy.mockRestore();
  });

  it('updateTag throws TagNotFoundError for tag in another workspace', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    const findFirstSpy = vi.spyOn(sharedPrisma.tag, 'findFirst').mockResolvedValue(null as never);

    await expect(updateTag('tag-other-workspace', { name: 'New' })).rejects.toThrow(TagNotFoundError);

    findFirstSpy.mockRestore();
  });

  it('deleteTag throws TagNotFoundError for tag in another workspace', async () => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    const findFirstSpy = vi.spyOn(sharedPrisma.tag, 'findFirst').mockResolvedValue(null as never);

    await expect(deleteTag('tag-other-workspace')).rejects.toThrow(TagNotFoundError);

    findFirstSpy.mockRestore();
  });
});
