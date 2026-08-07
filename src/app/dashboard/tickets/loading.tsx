import { TicketListSkeleton } from '@/components/tickets/ticket-list-skeleton';

export default function TicketsLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="h-7 w-32 rounded-md bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-4 w-56 rounded-md bg-neutral-200 dark:bg-neutral-700" />
        </div>
        <TicketListSkeleton />
      </div>
    </div>
  );
}
