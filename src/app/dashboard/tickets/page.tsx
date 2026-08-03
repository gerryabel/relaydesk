import { getTickets } from '@/lib/tickets/server';
import TicketCard from '@/components/tickets/ticket-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default async function TicketsPage() {
  const tickets = await getTickets();

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
          <Button href="/dashboard/tickets/new">New ticket</Button>
        </header>

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
    </div>
  );
}
