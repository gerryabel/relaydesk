import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from '@/app/api/tags/[id]/route';
import { DuplicateTagError, TagNotFoundError } from '@/lib/tags/server';

vi.mock('@/lib/tags/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tags/server')>();
  return {
    ...actual,
    getTagById: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
  };
});

const mockedTagServer = await import('@/lib/tags/server');

afterEach(() => {
  vi.resetAllMocks();
});

function createTagIdRequest(id: string, init?: RequestInit) {
  return new NextRequest(`http://localhost/api/tags/${id}`, {
    ...init,
    signal: undefined,
  });
}

describe('tag id API', () => {
  it('GET returns a tag by id', async () => {
    vi.mocked(mockedTagServer.getTagById).mockResolvedValueOnce({
      id: 'tag-1',
      name: 'Billing',
      normalizedName: 'billing',
    } as never);

    const response = await GET(createTagIdRequest('tag-1'), { params: Promise.resolve({ id: 'tag-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('Billing');
  });

  it('GET throws notFound when tag is missing', async () => {
    vi.mocked(mockedTagServer.getTagById).mockRejectedValueOnce(new TagNotFoundError());

    await expect(GET(createTagIdRequest('missing'), { params: Promise.resolve({ id: 'missing' }) })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('PATCH updates a tag name', async () => {
    vi.mocked(mockedTagServer.updateTag).mockResolvedValueOnce({
      id: 'tag-1',
      name: 'VIP',
      normalizedName: 'vip',
    } as never);

    const response = await PATCH(
      createTagIdRequest('tag-1', { method: 'PATCH', body: JSON.stringify({ name: 'VIP' }) }),
      { params: Promise.resolve({ id: 'tag-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('VIP');
  });

  it('PATCH returns 409 on duplicate tag name', async () => {
    vi.mocked(mockedTagServer.updateTag).mockRejectedValueOnce(new DuplicateTagError());

    const response = await PATCH(
      createTagIdRequest('tag-1', { method: 'PATCH', body: JSON.stringify({ name: 'VIP' }) }),
      { params: Promise.resolve({ id: 'tag-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('Tag dengan nama yang sama sudah ada di workspace ini.');
  });

  it('DELETE removes a tag', async () => {
    vi.mocked(mockedTagServer.deleteTag).mockResolvedValueOnce({ ok: true } as never);

    const response = await DELETE(createTagIdRequest('tag-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'tag-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('DELETE throws notFound when tag is missing', async () => {
    vi.mocked(mockedTagServer.deleteTag).mockRejectedValueOnce(new TagNotFoundError());

    await expect(DELETE(createTagIdRequest('missing', { method: 'DELETE' }), { params: Promise.resolve({ id: 'missing' }) })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});
