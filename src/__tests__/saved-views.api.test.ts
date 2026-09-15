import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as listViews, POST } from '@/app/api/saved-views/route';
import {
  GET as getView,
  PATCH,
  DELETE,
} from '@/app/api/saved-views/[id]/route';
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
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';

vi.mock('@/lib/saved-views/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/saved-views/server')>();
  return {
    ...actual,
    listSavedViews: vi.fn(actual.listSavedViews),
    getSavedView: vi.fn(actual.getSavedView),
    createSavedView: vi.fn(actual.createSavedView),
    updateSavedView: vi.fn(actual.updateSavedView),
    deleteSavedView: vi.fn(actual.deleteSavedView),
  };
});

const mockedListSavedViews = vi.mocked(listSavedViews);
const mockedGetSavedView = vi.mocked(getSavedView);
const mockedCreateSavedView = vi.mocked(createSavedView);
const mockedUpdateSavedView = vi.mocked(updateSavedView);
const mockedDeleteSavedView = vi.mocked(deleteSavedView);

function createIdRequest(id: string, init?: RequestInit) {
  return new NextRequest(`http://localhost/api/saved-views/${id}`, {
    ...init,
    signal: undefined,
  });
}

const fakeView = {
  id: 'sv-1',
  name: 'My View',
  type: 'tickets',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
  filterState: { status: 'open' },
  sortState: { field: 'createdAt', direction: 'desc' },
  viewState: 'my-open',
};

afterEach(() => {
  mockedListSavedViews.mockReset();
  mockedGetSavedView.mockReset();
  mockedCreateSavedView.mockReset();
  mockedUpdateSavedView.mockReset();
  mockedDeleteSavedView.mockReset();
  vi.restoreAllMocks();
});

describe('saved views list API', () => {
  it('GET returns 401 when unauthenticated', async () => {
    mockedListSavedViews.mockRejectedValueOnce(
      new UnauthorizedError('No authenticated session'),
    );

    const response = await listViews();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('GET returns 403 when no membership', async () => {
    mockedListSavedViews.mockRejectedValueOnce(
      new ForbiddenError('No workspace membership found'),
    );

    const response = await listViews();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('GET returns saved views when authorized', async () => {
    mockedListSavedViews.mockResolvedValueOnce([
      { id: 'sv-1', name: 'My View', type: 'tickets', createdAt: '', updatedAt: '' },
    ] as never);

    const response = await listViews();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('sv-1');
  });

  it('POST returns 400 for invalid payload', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/saved-views', {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
        signal: undefined,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('POST returns 201 and the created view when valid', async () => {
    mockedCreateSavedView.mockResolvedValueOnce(fakeView as never);

    const response = await POST(
      new NextRequest('http://localhost/api/saved-views', {
        method: 'POST',
        body: JSON.stringify({ name: 'New View', type: 'tickets' }),
        signal: undefined,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('sv-1');
    expect(mockedCreateSavedView).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New View', type: 'tickets' }),
    );
  });

  it('POST returns 409 for duplicate name', async () => {
    mockedCreateSavedView.mockRejectedValueOnce(new DuplicateSavedViewNameError());

    const response = await POST(
      new NextRequest('http://localhost/api/saved-views', {
        method: 'POST',
        body: JSON.stringify({ name: 'Duplicate', type: 'tickets' }),
        signal: undefined,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain('sudah digunakan');
  });
});

describe('saved view detail API', () => {
  it('GET returns 404 when not found', async () => {
    mockedGetSavedView.mockRejectedValueOnce(new SavedViewNotFoundError());

    const response = await getView(createIdRequest('sv-1'), {
      params: Promise.resolve({ id: 'sv-1' }),
    });

    expect(response.status).toBe(404);
  });

  it('GET returns 403 when forbidden', async () => {
    mockedGetSavedView.mockRejectedValueOnce(new SavedViewForbiddenError());

    const response = await getView(createIdRequest('sv-1'), {
      params: Promise.resolve({ id: 'sv-1' }),
    });

    expect(response.status).toBe(403);
  });

  it('GET returns the saved view when owned', async () => {
    mockedGetSavedView.mockResolvedValueOnce(fakeView as never);

    const response = await getView(createIdRequest('sv-1'), {
      params: Promise.resolve({ id: 'sv-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('sv-1');
  });

  it('PATCH returns 400 for invalid payload', async () => {
    const response = await PATCH(
      createIdRequest('sv-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: '   ' }),
      }),
      { params: Promise.resolve({ id: 'sv-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('PATCH returns updated view when valid', async () => {
    mockedUpdateSavedView.mockResolvedValueOnce({ ...fakeView, name: 'Renamed' } as never);

    const response = await PATCH(
      createIdRequest('sv-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
      }),
      { params: Promise.resolve({ id: 'sv-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('Renamed');
  });

  it('PATCH returns 404 when not found', async () => {
    mockedUpdateSavedView.mockRejectedValueOnce(new SavedViewNotFoundError());

    const response = await PATCH(
      createIdRequest('sv-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'X' }),
      }),
      { params: Promise.resolve({ id: 'sv-1' }) },
    );

    expect(response.status).toBe(404);
  });

  it('PATCH returns 403 when forbidden', async () => {
    mockedUpdateSavedView.mockRejectedValueOnce(new SavedViewForbiddenError());

    const response = await PATCH(
      createIdRequest('sv-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'X' }),
      }),
      { params: Promise.resolve({ id: 'sv-1' }) },
    );

    expect(response.status).toBe(403);
  });

  it('PATCH returns 409 for duplicate name', async () => {
    mockedUpdateSavedView.mockRejectedValueOnce(new DuplicateSavedViewNameError());

    const response = await PATCH(
      createIdRequest('sv-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Taken' }),
      }),
      { params: Promise.resolve({ id: 'sv-1' }) },
    );

    expect(response.status).toBe(409);
  });

  it('DELETE returns the deleted id when owned', async () => {
    mockedDeleteSavedView.mockResolvedValueOnce({ id: 'sv-1' } as never);

    const response = await DELETE(createIdRequest('sv-1'), {
      params: Promise.resolve({ id: 'sv-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('sv-1');
  });

  it('DELETE returns 404 when not found', async () => {
    mockedDeleteSavedView.mockRejectedValueOnce(new SavedViewNotFoundError());

    const response = await DELETE(createIdRequest('sv-1'), {
      params: Promise.resolve({ id: 'sv-1' }),
    });

    expect(response.status).toBe(404);
  });

  it('DELETE returns 403 when forbidden', async () => {
    mockedDeleteSavedView.mockRejectedValueOnce(new SavedViewForbiddenError());

    const response = await DELETE(createIdRequest('sv-1'), {
      params: Promise.resolve({ id: 'sv-1' }),
    });

    expect(response.status).toBe(403);
  });
});
