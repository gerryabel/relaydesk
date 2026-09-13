import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/members/[id]/route';
import { GET as listMembers } from '@/app/api/members/route';
import {
  getMembers,
  getMemberById,
  updateMemberRole,
  MemberNotFoundError,
  MemberNotInWorkspaceError,
  CannotDemoteLastOwnerError,
  InvalidRoleChangeError,
} from '@/lib/members/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';

vi.mock('@/lib/members/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/members/server')>();
  return {
    ...actual,
    getMembers: vi.fn(actual.getMembers),
    getMemberById: vi.fn(actual.getMemberById),
    updateMemberRole: vi.fn(actual.updateMemberRole),
  };
});

const mockedGetMembers = vi.mocked(getMembers);
const mockedGetMemberById = vi.mocked(getMemberById);
const mockedUpdateMemberRole = vi.mocked(updateMemberRole);

function createDetailRequest(init?: RequestInit) {
  return new NextRequest('http://localhost/api/members/membership-1', {
    ...init,
    signal: undefined,
  });
}

const fakeMember = {
  membershipId: 'membership-1',
  userId: 'user-123',
  name: 'User Satu',
  email: 'user1@example.com',
  image: null,
  role: 'owner',
  joinedAt: '2025-01-01T00:00:00.000Z',
  isAssignable: true,
};

afterEach(() => {
  mockedGetMembers.mockReset();
  mockedGetMemberById.mockReset();
  mockedUpdateMemberRole.mockReset();
  vi.restoreAllMocks();
});

describe('members list API auth and behavior', () => {
  it('GET returns 401 when membership resolution fails', async () => {
    mockedGetMembers.mockRejectedValueOnce(new UnauthorizedError('No authenticated session'));

    const response = await listMembers();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('GET returns 403 when membership resolution fails', async () => {
    mockedGetMembers.mockRejectedValueOnce(new ForbiddenError('No workspace membership found'));

    const response = await listMembers();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('GET returns members when authorized', async () => {
    mockedGetMembers.mockResolvedValueOnce([fakeMember] as never);

    const response = await listMembers();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].membershipId).toBe('membership-1');
    expect(body[0].isAssignable).toBe(true);
  });
});

describe('member detail API auth and behavior', () => {
  it('GET returns 404 when member is not in workspace', async () => {
    mockedGetMemberById.mockRejectedValueOnce(new MemberNotInWorkspaceError());

    const response = await GET(createDetailRequest(), {
      params: Promise.resolve({ id: 'membership-1' }),
    });

    expect(response.status).toBe(404);
  });

  it('GET returns member when authorized', async () => {
    mockedGetMemberById.mockResolvedValueOnce(fakeMember as never);

    const response = await GET(createDetailRequest(), {
      params: Promise.resolve({ id: 'membership-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.membershipId).toBe('membership-1');
  });

  it('PATCH returns 400 for invalid payload', async () => {
    const response = await PATCH(
      createDetailRequest({ method: 'PATCH', body: JSON.stringify({ role: 'admin' }) }),
      { params: Promise.resolve({ id: 'membership-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('PATCH returns 403 when caller is not owner', async () => {
    mockedUpdateMemberRole.mockRejectedValueOnce(
      new ForbiddenError('Only workspace owners can perform this action.'),
    );

    const response = await PATCH(
      createDetailRequest({ method: 'PATCH', body: JSON.stringify({ role: 'member' }) }),
      { params: Promise.resolve({ id: 'membership-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('PATCH returns 404 when target member not found', async () => {
    mockedUpdateMemberRole.mockRejectedValueOnce(new MemberNotFoundError());

    const response = await PATCH(
      createDetailRequest({ method: 'PATCH', body: JSON.stringify({ role: 'owner' }) }),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Member not found');
  });

  it('PATCH returns 400 when demoting last owner', async () => {
    mockedUpdateMemberRole.mockRejectedValueOnce(new CannotDemoteLastOwnerError());

    const response = await PATCH(
      createDetailRequest({ method: 'PATCH', body: JSON.stringify({ role: 'member' }) }),
      { params: Promise.resolve({ id: 'membership-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('owner terakhir');
  });

  it('PATCH returns 400 when role is unchanged (no-op)', async () => {
    mockedUpdateMemberRole.mockRejectedValueOnce(
      new InvalidRoleChangeError('Member already has role: owner'),
    );

    const response = await PATCH(
      createDetailRequest({ method: 'PATCH', body: JSON.stringify({ role: 'owner' }) }),
      { params: Promise.resolve({ id: 'membership-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('already has role');
  });

  it('PATCH returns updated member when authorized and valid', async () => {
    const updated = { ...fakeMember, role: 'member' as const };
    mockedUpdateMemberRole.mockResolvedValueOnce(updated as never);

    const response = await PATCH(
      createDetailRequest({ method: 'PATCH', body: JSON.stringify({ role: 'member' }) }),
      { params: Promise.resolve({ id: 'membership-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.role).toBe('member');
    expect(mockedUpdateMemberRole).toHaveBeenCalledWith('membership-1', { role: 'member' });
  });
});
