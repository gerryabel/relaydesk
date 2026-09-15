import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/workspace-settings/route';
import {
  getWorkspaceSettings,
  updateWorkspaceName,
} from '@/lib/workspace/settings';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';

vi.mock('@/lib/workspace/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/settings')>();
  return {
    ...actual,
    getWorkspaceSettings: vi.fn(actual.getWorkspaceSettings),
    updateWorkspaceName: vi.fn(actual.updateWorkspaceName),
  };
});

const mockedGetWorkspaceSettings = vi.mocked(getWorkspaceSettings);
const mockedUpdateWorkspaceName = vi.mocked(updateWorkspaceName);

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/workspace-settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
    signal: undefined,
  });
}

afterEach(() => {
  mockedGetWorkspaceSettings.mockReset();
  mockedUpdateWorkspaceName.mockReset();
  vi.restoreAllMocks();
});

describe('workspace settings API — GET', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetWorkspaceSettings.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 when no workspace membership', async () => {
    mockedGetWorkspaceSettings.mockRejectedValueOnce(
      new ForbiddenError('No workspace membership found'),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('returns the workspace settings when authorized', async () => {
    mockedGetWorkspaceSettings.mockResolvedValueOnce({
      id: 'workspace-123',
      name: 'Workspace 123',
    } as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: 'workspace-123', name: 'Workspace 123' });
  });
});

describe('workspace settings API — PATCH', () => {
  it('returns 400 for invalid payload', async () => {
    const response = await PATCH(createPatchRequest({ name: '' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 400 for whitespace-only payload', async () => {
    const response = await PATCH(createPatchRequest({ name: '     ' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Workspace name cannot be empty');
  });

  it('returns 400 for over-max-length payload', async () => {
    const response = await PATCH(createPatchRequest({ name: 'a'.repeat(101) }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('100');
  });

  it('returns 400 for malformed JSON', async () => {
    const request = new NextRequest('http://localhost/api/workspace-settings', {
      method: 'PATCH',
      body: 'not-json',
      signal: undefined,
    });

    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 401 when unauthenticated', async () => {
    mockedUpdateWorkspaceName.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    const response = await PATCH(createPatchRequest({ name: 'New Name' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 when caller is not owner', async () => {
    mockedUpdateWorkspaceName.mockRejectedValueOnce(
      new ForbiddenError('Only workspace owners can perform this action.'),
    );

    const response = await PATCH(createPatchRequest({ name: 'New Name' }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('returns updated settings when authorized and valid', async () => {
    mockedUpdateWorkspaceName.mockResolvedValueOnce({
      id: 'workspace-123',
      name: 'New Name',
    } as never);

    const response = await PATCH(createPatchRequest({ name: 'New Name' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: 'workspace-123', name: 'New Name' });
    expect(mockedUpdateWorkspaceName).toHaveBeenCalledWith({ name: 'New Name' });
  });

  it('trims a name with surrounding whitespace before delegating to the service', async () => {
    mockedUpdateWorkspaceName.mockResolvedValueOnce({
      id: 'workspace-123',
      name: 'New Name',
    } as never);

    const response = await PATCH(createPatchRequest({ name: '  New Name  ' }));
    const body = await response.json();

    // Zod transform trims the value before it reaches the service.
    expect(response.status).toBe(200);
    expect(mockedUpdateWorkspaceName).toHaveBeenCalledWith({ name: 'New Name' });
    expect(body.name).toBe('New Name');
  });
});
