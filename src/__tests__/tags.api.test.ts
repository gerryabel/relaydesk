import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET, POST } from '@/app/api/tags/route';
import { GET as TAG_GET, PATCH, DELETE } from '@/app/api/tags/[id]/route';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';
import { DuplicateTagError, TagNotFoundError } from '@/lib/tags/server';

vi.mock('@/lib/workspace/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/server')>();
  return {
    ...actual,
    getCurrentMembership: vi.fn(),
  };
});

vi.mock('@/lib/tags/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tags/server')>();
  return {
    ...actual,
    getTags: vi.fn(),
    createTag: vi.fn(),
    getTagById: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
  };
});

const mockedTagServer = await import('@/lib/tags/server');

afterEach(() => {
  vi.resetAllMocks();
});

describe('tags API', () => {
  it('GET returns tags when authorized', async () => {
    vi.mocked(mockedTagServer.getTags).mockResolvedValueOnce([
      { id: 'tag-1', name: 'Billing', normalizedName: 'billing' },
    ] as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: 'tag-1', name: 'Billing', normalizedName: 'billing' }]);
  });

  it('GET returns 401 when membership resolution fails', async () => {
    vi.mocked(mockedTagServer.getTags).mockRejectedValueOnce(new UnauthorizedError('Unauthorized') as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('GET returns 403 when membership is missing', async () => {
    vi.mocked(mockedTagServer.getTags).mockRejectedValueOnce(new ForbiddenError('Forbidden') as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('POST creates a tag with valid input', async () => {
    vi.mocked(mockedTagServer.createTag).mockResolvedValueOnce({
      id: 'tag-1',
      name: 'Billing',
      normalizedName: 'billing',
    } as never);

    const response = await POST(new Request('http://localhost/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name: 'Billing' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.name).toBe('Billing');
  });

  it('POST returns 400 when name is missing', async () => {
    const response = await POST(new Request('http://localhost/api/tags', {
      method: 'POST',
      body: JSON.stringify({}),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Nama tag wajib diisi');
  });

  it('POST returns 409 on duplicate tag name', async () => {
    vi.mocked(mockedTagServer.createTag).mockRejectedValueOnce(new DuplicateTagError());

    const response = await POST(new Request('http://localhost/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name: 'Billing' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('Tag dengan nama yang sama sudah ada di workspace ini.');
  });

  it('TAG_GET returns a tag by id', async () => {
    vi.mocked(mockedTagServer.getTagById).mockResolvedValueOnce({
      id: 'tag-1',
      name: 'Billing',
      normalizedName: 'billing',
    } as never);

    const response = await TAG_GET(new Request('http://localhost/api/tags/tag-1'), { params: Promise.resolve({ id: 'tag-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('Billing');
  });

  it('TAG_GET throws notFound when tag is missing', async () => {
    vi.mocked(mockedTagServer.getTagById).mockRejectedValueOnce(new TagNotFoundError());

    await expect(TAG_GET(new Request('http://localhost/api/tags/missing'), { params: Promise.resolve({ id: 'missing' }) })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('PATCH updates a tag name', async () => {
    vi.mocked(mockedTagServer.updateTag).mockResolvedValueOnce({
      id: 'tag-1',
      name: 'VIP',
      normalizedName: 'vip',
    } as never);

    const response = await PATCH(
      new Request('http://localhost/api/tags/tag-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'VIP' }),
      }),
      { params: Promise.resolve({ id: 'tag-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('VIP');
  });

  it('PATCH returns 409 on duplicate tag name', async () => {
    vi.mocked(mockedTagServer.updateTag).mockRejectedValueOnce(new DuplicateTagError());

    const response = await PATCH(
      new Request('http://localhost/api/tags/tag-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'VIP' }),
      }),
      { params: Promise.resolve({ id: 'tag-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('Tag dengan nama yang sama sudah ada di workspace ini.');
  });

  it('DELETE removes a tag', async () => {
    vi.mocked(mockedTagServer.deleteTag).mockResolvedValueOnce({ ok: true } as never);

    const response = await DELETE(new Request('http://localhost/api/tags/tag-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'tag-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('DELETE throws notFound when tag is missing', async () => {
    vi.mocked(mockedTagServer.deleteTag).mockRejectedValueOnce(new TagNotFoundError());

    await expect(DELETE(new Request('http://localhost/api/tags/missing', { method: 'DELETE' }), { params: Promise.resolve({ id: 'missing' }) })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});
