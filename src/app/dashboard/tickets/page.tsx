import { getTickets } from '@/lib/tickets/server';
import TicketSelectionList from '@/components/tickets/ticket-selection-list';
import { EmptyState } from '@/components/ui/empty-state';
import TicketFilterControls from '@/components/tickets/ticket-filters';
import TicketSortControls from '@/components/tickets/ticket-sort-control';
import { ticketSearchSchema, ticketStatusFilterSchema, ticketPriorityFilterSchema, ticketAssigneeFilterSchema } from '@/lib/tickets/schema';
import type { TicketFiltersInput } from '@/lib/tickets/schema';
import { normalizeTicketSort, type TicketSortInput } from '@/lib/tickets/sort';
import Link from 'next/link';
import { getWorkspaceMembers } from '@/lib/workspace/server';
import { getTags } from '@/lib/tags/server';

export function parseFilters(resolved: Record<string, unknown>): TicketFiltersInput {
  const search = (resolved.q ?? resolved.search) as string | undefined;
  const searchParsed = ticketSearchSchema.safeParse({ search });
  const statusParsed = ticketStatusFilterSchema.safeParse({ status: resolved.status });
  const priorityParsed = ticketPriorityFilterSchema.safeParse({ priority: resolved.priority });
  const assigneeParsed = ticketAssigneeFilterSchema.safeParse({ assignee: resolved.assignee });

  return {
    search: searchParsed.success ? searchParsed.data.search : undefined,
    status: statusParsed.success ? statusParsed.data.status : undefined,
    priority: priorityParsed.success ? priorityParsed.data.priority : undefined,
    assignee: assigneeParsed.success ? assigneeParsed.data.assignee : undefined,
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

export function buildQueryString(
  searchParams: URLSearchParams,
  nextSearch: string,
  nextStatus: string,
  nextPriority: string,
  nextAssignee: string,
  nextTagId: string
) {
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

  if (!nextAssignee) {
    params.delete('assignee');
  } else {
    params.set('assignee', nextAssignee);
  }

  if (!nextTagId) {
    params.delete('tagId');
  } else {
    params.set('tagId', nextTagId);
  }

  return params.toString();
}

export function buildResolvedSearchParams(resolved: Record<string, unknown>) {
  const search = (resolved.q ?? resolved.search) as string | undefined;
  const status = (resolved.status as string | undefined) ?? '';
  const priority = (resolved.priority as string | undefined) ?? '';
  const assignee = (resolved.assignee as string | undefined) ?? '';
  const sort = (resolved.sort as string | undefined) ?? '';

  return new URLSearchParams({
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(assignee ? { assignee } : {}),
    ...(sort ? { sort } : {}),
  });
}

export function buildPaginationQuery(resolved: Record<string, unknown>, page: number, limit: number) {
  const entries = Object.entries(resolved).filter(([, value]) => value !== '' && value !== undefined);
  const params = new URLSearchParams({
    ...Object.fromEntries(entries),
    page: String(page),
    limit: String(limit),
  });

  return params.toString();
}

type FilteredTicketsPagePropsResolved = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function FilteredTicketsPage({ searchParams }: FilteredTicketsPagePropsResolved) {
  const resolved = searchParams ? await searchParams : {};
  const filters = parseFilters(resolved);
  const sort = parseSort(resolved);
  const page = parsePage(resolved);
  const limit = parseLimit(resolved);
  const resolvedSearchParams = buildResolvedSearchParams(resolved);
  const [allMembers, tags] = await Promise.all([getWorkspaceMembers(), getTags()]);
  const members = allMembers.map(({ id, name, email }) => ({ id, name, email }));

  const result = await getTickets({
    status: filters.status,
    priority: filters.priority,
    assignee: filters.assignee,
    search: filters.search ? { q: filters.search } : undefined,
    sort,
    page,
    limit,
    tagIds: resolved.tagId && typeof resolved.tagId === 'string' ? [resolved.tagId] : undefined,
  });

  const hasActiveFilters = Boolean(filters.search || filters.status || filters.priority || filters.assignee || resolved.tagId);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Tickets</h1>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              Kelola dan lacak tiket di workspace kamu.
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TicketFilterControls members={members} tags={tags} />
            <TicketSortControls />
          </div>
        </div>

        {hasActiveFilters ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
            <span id="active-filters-label">Filter aktif:</span>
            {filters.search ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700">
                Pencarian: {filters.search}
                <Link
                  href={`?${buildQueryString(resolvedSearchParams, '', filters.status ?? '', filters.priority ?? '', filters.assignee ?? '', (resolved.tagId as string | undefined) ?? '')}`}
                  aria-label={`Hapus filter pencarian: ${filters.search}`}
                  className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  ×
                </Link>
              </span>
            ) : null}
            {filters.status ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700">
                Status: {filters.status}
                <Link
                  href={`?${buildQueryString(resolvedSearchParams, filters.search ?? '', '', filters.priority ?? '', filters.assignee ?? '', (resolved.tagId as string | undefined) ?? '')}`}
                  aria-label={`Hapus filter status: ${filters.status}`}
                  className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  ×
                </Link>
              </span>
            ) : null}
            {filters.priority ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700">
                Prioritas: {filters.priority}
                <Link
                  href={`?${buildQueryString(resolvedSearchParams, filters.search ?? '', filters.status ?? '', '', filters.assignee ?? '', (resolved.tagId as string | undefined) ?? '')}`}
                  aria-label={`Hapus filter prioritas: ${filters.priority}`}
                  className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  ×
                </Link>
              </span>
            ) : null}
            {filters.assignee ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700">
                Assignee: {filters.assignee}
                <Link
                  href={`?${buildQueryString(resolvedSearchParams, filters.search ?? '', filters.status ?? '', filters.priority ?? '', '', (resolved.tagId as string | undefined) ?? '')}`}
                  aria-label={`Hapus filter assignee: ${filters.assignee}`}
                  className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  ×
                </Link>
              </span>
            ) : null}
            {resolved.tagId ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700">
                Tag: {resolved.tagId}
                <Link
                  href={`?${buildQueryString(resolvedSearchParams, filters.search ?? '', filters.status ?? '', filters.priority ?? '', filters.assignee ?? '', '')}`}
                  aria-label={`Hapus filter tag: ${resolved.tagId}`}
                  className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  ×
                </Link>
              </span>
            ) : null}
            <Link
              href="/dashboard/tickets"
              aria-label="Reset semua filter"
              className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Reset semua
            </Link>
          </div>
        ) : null}

        {result.data.length === 0 ? (
          <EmptyState
            title={hasActiveFilters ? 'Tidak ada tiket yang cocok' : 'Belum ada tiket'}
            description={
              hasActiveFilters
                ? 'Coba ubah pencarian atau filter untuk melihat hasil lain.'
                : 'Buat tiket pertama untuk mulai melacak pekerjaan atau permintaan.'
            }
            action={
              hasActiveFilters ? (
                <Link href="/dashboard/tickets" className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 text-sm hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100">
                  Reset filter
                </Link>
              ) : (
                <Link href="/dashboard/tickets/new" className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-2 text-sm text-white">
                  Create ticket
                </Link>
              )
            }
          />
        ) : (
          <TicketSelectionList
            tickets={result.data}
            members={members}
            tags={tags}
          />
        )}

        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Navigasi tiket">
          <span className="min-w-0 text-neutral-600 dark:text-neutral-300">
            Halaman {result.page} dari {result.totalPages} • {result.total} tiket
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {result.hasPreviousPage ? (
              <Link
                href={`?${buildPaginationQuery(resolved, result.page - 1, result.limit)}`}
                className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
              >
                Sebelumnya
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 opacity-60 dark:border-neutral-700"
              >
                Sebelumnya
              </span>
            )}
            {result.hasNextPage ? (
              <Link
                href={`?${buildPaginationQuery(resolved, result.page + 1, result.limit)}`}
                className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
              >
                Berikutnya
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 opacity-60 dark:border-neutral-700"
              >
                Berikutnya
              </span>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}
