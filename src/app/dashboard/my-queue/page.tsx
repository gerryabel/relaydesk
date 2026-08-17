import { getMyQueueTickets, getMyQueueCounts, resolveQueueView, DEFAULT_QUEUE_VIEW, QUEUE_VIEW_LABELS, QUEUE_VIEW_ORDER } from '@/lib/tickets/queue';
import TicketCard from '@/components/tickets/ticket-card';
import { EmptyState } from '@/components/ui/empty-state';
import TicketFilterControls from '@/components/tickets/ticket-filters';
import TicketSortControls from '@/components/tickets/ticket-sort-control';
import { ticketSearchSchema, ticketStatusFilterSchema, ticketPriorityFilterSchema } from '@/lib/tickets/schema';
import type { TicketFiltersInput } from '@/lib/tickets/schema';
import { normalizeTicketSort, type TicketSortInput } from '@/lib/tickets/sort';
import Link from 'next/link';
import { getTags } from '@/lib/tags/server';

export function parseFilters(resolved: Record<string, unknown>): TicketFiltersInput {
  const search = (resolved.q ?? resolved.search) as string | undefined;
  const searchParsed = ticketSearchSchema.safeParse({ search });
  const statusParsed = ticketStatusFilterSchema.safeParse({ status: resolved.status });
  const priorityParsed = ticketPriorityFilterSchema.safeParse({ priority: resolved.priority });

  return {
    search: searchParsed.success ? searchParsed.data.search : undefined,
    status: statusParsed.success ? statusParsed.data.status : undefined,
    priority: priorityParsed.success ? priorityParsed.data.priority : undefined,
  };
}

export function parseSort(resolved: Record<string, unknown>): TicketSortInput | undefined {
  const raw = (resolved.sort as string | undefined) ?? '';

  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return undefined;
  }

  const [field, direction] = trimmed.split(':');
  const normalizedField = (field ?? '').trim();
  const normalizedDirection = (direction ?? '').trim();

  if (!normalizedField || !normalizedDirection) {
    return normalizeTicketSort(normalizedField || trimmed);
  }

  return normalizeTicketSort({ field: normalizedField, direction: normalizedDirection });
}

function parsePage(resolved: Record<string, unknown>) {
  const raw = Number((resolved.page ?? resolved.p ?? '1') as unknown as number);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
}

function parseLimit(resolved: Record<string, unknown>) {
  const raw = Number((resolved.limit ?? resolved.per_page ?? '20') as unknown as number);
  const safe = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20;
  return Math.min(safe, 100);
}

function parseView(resolved: Record<string, unknown>) {
  return resolveQueueView((resolved.view as string | undefined) ?? DEFAULT_QUEUE_VIEW);
}

export function buildQueueQueryString(
  searchParams: URLSearchParams,
  nextSearch: string,
  nextStatus: string,
  nextPriority: string,
  nextView: string
): URLSearchParams {
  const params = new URLSearchParams(searchParams.toString());

  if (!nextSearch) {
    params.delete('search');
  } else {
    params.set('search', nextSearch);
  }

  if (!nextStatus) {
    params.delete('status');
  } else {
    params.set('status', nextStatus);
  }

  if (!nextPriority) {
    params.delete('priority');
  } else {
    params.set('priority', nextPriority);
  }

  if (!nextView || nextView === DEFAULT_QUEUE_VIEW) {
    params.delete('view');
  } else {
    params.set('view', nextView);
  }

  return params;
}

function buildViewQueryString(resolved: Record<string, unknown>, view: string): string {
  const search = (resolved.search as string | undefined) ?? '';
  const status = (resolved.status as string | undefined) ?? '';
  const priority = (resolved.priority as string | undefined) ?? '';
  const sort = (resolved.sort as string | undefined) ?? '';
  const tagId = (resolved.tagId as string | undefined) ?? '';

  const merged = new URLSearchParams();

  if (search.trim() !== '') {
    merged.set('search', search.trim());
  }
  if (status.trim() !== '') {
    merged.set('status', status.trim());
  }
  if (priority.trim() !== '') {
    merged.set('priority', priority.trim());
  }
  if (sort.trim() !== '') {
    merged.set('sort', sort.trim());
  }
  if (tagId.trim() !== '') {
    merged.set('tagId', tagId.trim());
  }

  if (view && view !== DEFAULT_QUEUE_VIEW) {
    merged.set('view', view);
  }

  if ([...merged.values()].length === 0) {
    return '';
  }

  return `?${merged.toString()}`;
}

function buildPaginationQuery(resolved: Record<string, unknown>, page: number, limit: number, view: string) {
  const allowedKeys = ['search', 'status', 'priority', 'sort', 'tagId'];
  const params = new URLSearchParams();

  for (const key of allowedKeys) {
    const value = resolved[key];
    if (typeof value === 'string' && value.trim() !== '') {
      params.set(key, value.trim());
    }
  }

  if (view && view !== DEFAULT_QUEUE_VIEW) {
    params.set('view', view);
  }

  params.set('page', String(page));
  params.set('limit', String(limit));

  return params.toString();
}

const viewEmptyState: Record<string, { title: string; description: string }> = {
  'my-open': {
    title: 'My Open',
    description: 'Kamu tidak memiliki tiket terbuka atau in progress saat ini.',
  },
  waiting: {
    title: 'Waiting Customer',
    description: 'Tidak ada tiket yang menunggu respons customer.',
  },
  'high-priority': {
    title: 'High Priority',
    description: 'Tidak ada tiket high atau urgent yang perlu diperhatikan.',
  },
  'sla-risk': {
    title: 'SLA At Risk',
    description: 'Bagus, tidak ada tiket yang masuk area at risk saat ini.',
  },
};

type FilteredMyQueuePagePropsResolved = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function FilteredMyQueuePage({ searchParams }: FilteredMyQueuePagePropsResolved) {
  const resolved = searchParams ? await searchParams : {};
  const filters = parseFilters(resolved);
  const sort = parseSort(resolved);
  const page = parsePage(resolved);
  const limit = parseLimit(resolved);
  const view = parseView(resolved);
  const tags = await getTags();
  const [result, counts] = await Promise.all([
    getMyQueueTickets({ view, search: filters.search, sort, page, limit, status: filters.status, priority: filters.priority, tagIds: resolved.tagId && typeof resolved.tagId === 'string' ? [resolved.tagId] : undefined }),
    getMyQueueCounts({ view, search: filters.search, sort, status: filters.status, priority: filters.priority, tagIds: resolved.tagId && typeof resolved.tagId === 'string' ? [resolved.tagId] : undefined }),
  ]);

  const selectedView = view;
  const emptyState = viewEmptyState[selectedView] ?? viewEmptyState['my-open'];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">My Queue</h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            Tiket yang ditugaskan ke kamu dan perlu kamu selesaikan sekarang.
          </p>
        </header>

        <nav className="flex flex-wrap items-center gap-2" aria-label="My Queue views">
          {QUEUE_VIEW_ORDER.map((queueView) => {
            const isActive = queueView === selectedView;
            const viewLabel = QUEUE_VIEW_LABELS[queueView];
            const count = counts[queueView] ?? 0;
            const queueParams = buildViewQueryString(resolved, queueView);

            return (
              <Link
                key={queueView}
                href={queueParams}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                  isActive
                    ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                    : 'border-neutral-300 hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100'
                }`}
              >
                <span>{viewLabel}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${
                  isActive ? 'border-current bg-white/20 dark:bg-neutral-900/20' : 'border-neutral-300 dark:border-neutral-700'
                }`}>
                  {count}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TicketFilterControls members={[]} tags={tags} />
            <TicketSortControls />
          </div>
        </div>

        {result.data.length === 0 ? (
          <EmptyState title={emptyState.title} description={emptyState.description} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4">
              {result.data.map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} />
              ))}
            </div>

            <nav className="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Navigasi my queue">
              <span className="min-w-0 text-neutral-600 dark:text-neutral-300">
                Halaman {result.page} dari {result.totalPages} • {result.total} tiket
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {result.hasPreviousPage ? (
                  <Link
                    href={`?${buildPaginationQuery(resolved, result.page - 1, result.limit, selectedView)}`}
                    className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
                  >
                    Sebelumnya
                  </Link>
                ) : (
                  <span aria-disabled="true" className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 opacity-60 dark:border-neutral-700">
                    Sebelumnya
                  </span>
                )}
                {result.hasNextPage ? (
                  <Link
                    href={`?${buildPaginationQuery(resolved, result.page + 1, result.limit, selectedView)}`}
                    className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
                  >
                    Berikutnya
                  </Link>
                ) : (
                  <span aria-disabled="true" className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 opacity-60 dark:border-neutral-700">
                    Berikutnya
                  </span>
                )}
              </div>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
