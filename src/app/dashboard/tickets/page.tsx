import { getTickets } from '@/lib/tickets/server';
import TicketCard from '@/components/tickets/ticket-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';

export default async function TicketsPage(searchParams: { q?: string }) {
  const tickets = await getTickets({
    ...(searchParams?.q ? { search: { q: searchParams.q } } : {}),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <form className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="text-2xl font-semibold">Tickets</h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            Kelola dan lacak tiket di workspace kamu.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Input
            type="search"
            name="q"
            placeholder="Cari tiket..."
            defaultValue={searchParams?.q}
            className="sm:max-w-xs"
            aria-label="Cari tiket"
          />
          <Button type="submit">Search</Button>
        </div>
        <Button href="/dashboard/tickets/new">New ticket</Button>
      </form>

      {tickets.length === 0 ? (
        <EmptyState
          title="Belum ada tiket"
          description="Buat tiket pertama untuk mulai melacak pekerjaan atau permintaan."
          action={<Button href="/dashboard/tickets/new">Create ticket</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} />
          ))}
        </div>
      )}
    </div>
  );
}
