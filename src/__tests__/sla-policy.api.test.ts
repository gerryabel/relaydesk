import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/workspace-sla-policies/route';
import {
  getWorkspaceSlaPolicies,
  updateWorkspaceSlaPolicies,
} from '@/lib/workspace/sla-policy';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';

vi.mock('@/lib/workspace/sla-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/sla-policy')>();
  return {
    ...actual,
    getWorkspaceSlaPolicies: vi.fn(actual.getWorkspaceSlaPolicies),
    updateWorkspaceSlaPolicies: vi.fn(actual.updateWorkspaceSlaPolicies),
  };
});

const mockedGetWorkspaceSlaPolicies = vi.mocked(getWorkspaceSlaPolicies);
const mockedUpdateWorkspaceSlaPolicies = vi.mocked(updateWorkspaceSlaPolicies);

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/workspace-sla-policies', {
    method: 'PATCH',
    body: JSON.stringify(body),
    signal: undefined,
  });
}

const validPayload = [
  { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 },
  { priority: 'medium', responseMinutes: 480, resolutionMinutes: 4320 },
  { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
  { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
];

afterEach(() => {
  mockedGetWorkspaceSlaPolicies.mockReset();
  mockedUpdateWorkspaceSlaPolicies.mockReset();
  vi.restoreAllMocks();
});

describe('workspace SLA policies API — GET', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetWorkspaceSlaPolicies.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 when no workspace membership', async () => {
    mockedGetWorkspaceSlaPolicies.mockRejectedValueOnce(
      new ForbiddenError('No workspace membership found'),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('returns the policies when authorized', async () => {
    mockedGetWorkspaceSlaPolicies.mockResolvedValueOnce([
      { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 },
      { priority: 'medium', responseMinutes: 480, resolutionMinutes: 4320 },
      { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
      { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
    ] as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.policies).toHaveLength(4);
  });
});

describe('workspace SLA policies API — PATCH', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedUpdateWorkspaceSlaPolicies.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    const response = await PATCH(createPatchRequest(validPayload));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 when caller is not owner', async () => {
    mockedUpdateWorkspaceSlaPolicies.mockRejectedValueOnce(
      new ForbiddenError('Only workspace owners can perform this action.'),
    );

    const response = await PATCH(createPatchRequest(validPayload));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('returns 400 for an invalid payload', async () => {
    const response = await PATCH(
      createPatchRequest([
        { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 },
        { priority: 'medium', responseMinutes: 0, resolutionMinutes: 4320 },
        { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
        { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
      ]),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
    expect(mockedUpdateWorkspaceSlaPolicies).not.toHaveBeenCalled();
  });

  it('returns 400 for a payload with fewer than four entries', async () => {
    const response = await PATCH(
      createPatchRequest([{ priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 }]),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 400 for malformed JSON', async () => {
    const request = new NextRequest('http://localhost/api/workspace-sla-policies', {
      method: 'PATCH',
      body: 'not-json',
      signal: undefined,
    });

    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns updated policies when authorized and valid', async () => {
    mockedUpdateWorkspaceSlaPolicies.mockResolvedValueOnce([
      { priority: 'low', responseMinutes: 2880, resolutionMinutes: 14400 },
      { priority: 'medium', responseMinutes: 960, resolutionMinutes: 8640 },
      { priority: 'high', responseMinutes: 480, resolutionMinutes: 2880 },
      { priority: 'urgent', responseMinutes: 120, resolutionMinutes: 480 },
    ] as never);

    const response = await PATCH(createPatchRequest([
      { priority: 'low', responseMinutes: 2880, resolutionMinutes: 14400 },
      { priority: 'medium', responseMinutes: 960, resolutionMinutes: 8640 },
      { priority: 'high', responseMinutes: 480, resolutionMinutes: 2880 },
      { priority: 'urgent', responseMinutes: 120, resolutionMinutes: 480 },
    ]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.policies).toHaveLength(4);
    expect(mockedUpdateWorkspaceSlaPolicies).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate priorities with 400', async () => {
    const response = await PATCH(
      createPatchRequest([
        { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 },
        { priority: 'low', responseMinutes: 480, resolutionMinutes: 4320 },
        { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
        { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
      ]),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });
});
