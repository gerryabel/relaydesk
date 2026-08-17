import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMyQueueTickets, getMyQueueCounts, resolveQueueView, DEFAULT_QUEUE_VIEW } from '@/lib/tickets/queue';
import { getCurrentMembership } from '@/lib/workspace/server';

vi.mock('@/lib/tickets/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tickets/server')>();
  return { ...actual, getTickets: vi.fn() };
});

vi.mock('@/lib/workspace/server', () => ({ getCurrentMembership: vi.fn() }));

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership);
const mockedGetTickets = vi.mocked(await import('@/lib/tickets/server')).getTickets as ReturnType<typeof vi.fn>;

const fakeMembership = {
  userId: 'user-123',
  workspaceId: 'workspace-123',
  workspace: { id: 'workspace-123', name: 'Workspace 123', createdAt: new Date('2025-01-01T00:00:00Z'), updatedAt: new Date('2025-01-01T00:00:00Z') },
};

describe('queue domain', () => {
  beforeEach(() => {
    mockedGetCurrentMembership.mockResolvedValue(fakeMembership as never);
    mockedGetTickets.mockResolvedValue({ data: [], total: 0, totalPages: 1, page: 1, limit: 20, hasPreviousPage: false, hasNextPage: false } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolveQueueView normalizes and defaults', () => {
    expect(resolveQueueView(undefined)).toBe(DEFAULT_QUEUE_VIEW);
    expect(resolveQueueView('my-open')).toBe('my-open');
  });

  it('getMyQueueTickets enforces current-user scope', async () => {
    await getMyQueueTickets({});
    expect(mockedGetTickets).toHaveBeenCalledWith(expect.objectContaining({ assignee: 'user-123' }));
  });

  it('getMyQueueCounts returns baseline counts from mocked tickets', async () => {
    mockedGetTickets.mockResolvedValueOnce({
      data: [
        { id: 'open', status: 'open', priority: 'medium', workspaceId: 'workspace-123', title: '', description: '', createdAt: new Date('2025-01-01T00:00:00Z'), updatedAt: new Date('2025-01-01T00:00:00Z'), createdBy: null, responseSlaDeadline: new Date('2025-01-01T12:00:00Z'), resolutionSlaDeadline: new Date('2025-01-02T00:00:00Z'), firstResponseAt: null, resolvedAt: null },
      ],
      total: 1, totalPages: 1, page: 1, limit: 20, hasPreviousPage: false, hasNextPage: false,
    } as never);
    const counts = await getMyQueueCounts({});
    expect(counts['my-open']).toBe(1);
  });
});
