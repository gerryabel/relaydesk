import { getTickets } from '@/lib/tickets/server';
import TicketCard from '@/components/tickets/ticket-card';
import { EmptyState } from '@/components/ui/empty-state';
import TicketFilterControls from '@/components/tickets/ticket-filters';
import { ticketSearchSchema, ticketStatusFilterSchema, ticketPriorityFilterSchema } from '@/lib/tickets/schema';
import type { TicketFiltersInput } from '@/lib/tickets/schema';
import Link from 'next/link';

type FilteredTicketsPageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export function parseFilters(resolved: Record<string, unknown>): TicketFiltersInput {
  const searchParsed = ticketSearchSchema.safeParse({ search: resolved.search });
  const statusParsed = ticketStatusFilterSchema.safeParse({ status: resolved.status });
  const priorityParsed = ticketPriorityFilterSchema.safeParse({ priority: resolved.priority });

  return {
    search: searchParsed.success ? searchParsed.data.search : undefined,
    status: statusParsed.success ? statusParsed.data.status : undefined,
    priority: priorityParsed.success ? priorityParsed.data.priority : undefined,
  };
}

export default async function FilteredTicketsPage({ searchParams }: FilteredTicketsPageProps) {
  const resolved = searchParams ? await searchParams : {};
  const filters = parseFilters(resolved);

  const tickets = await getTickets(filters.status, filters.priority, filters.search);

  const hasActiveFilters = Boolean(filters.search || filters.status || filters.priority);

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

        <TicketFilterControls />

        {hasActiveFilters ? (
          <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
            <span>Filter aktif:</span>
            {filters.search ? (
              <span className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700">
                Pencarian: {filters.search}
              </span>
            ) : null}
            {filters.status ? (
              <span className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700">
                Status: {filters.status}
              </span>
            ) : null}
            {filters.priority ? (
              <span className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700">
                Prioritas: {filters.priority}
              </span>
            ) : null}
          </div>
        ) : null}

        {tickets.length === 0 ? (
          <EmptyState
            title={hasActiveFilters ? 'Tidak ada tiket yang cocok' : 'Belum ada tiket'}
            description={
              hasActiveFilters
                ? 'Coba ubah pencarian atau filter untuk melihat hasil lain.'
                : 'Buat tiket pertama untuk mulai melacak pekerjaan atau permintaan.'
            }
            action={hasActiveFilters ? null : <Link href="/dashboard/tickets/new" className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-2 text-sm text-white">Create ticket</Link>}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
