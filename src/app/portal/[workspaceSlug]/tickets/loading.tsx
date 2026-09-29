import { CustomerTicketListSkeleton } from '@/components/portal/customer-ticket-list-skeleton';

/**
 * Loading state for the ticket list route (Phase 9 Task 2).
 *
 * The header, the "New ticket" link and the search field are omitted on
 * purpose: they are static markup that renders instantly, and stubbing them
 * would flash a disabled control over the top of a perfectly usable one. Only
 * the list body — the part that actually waits on the database — is
 * skeletons.
 *
 * The skeleton rows are `aria-hidden` in the `Skeleton` primitive, so this
 * boundary announces nothing to a screen reader beyond the surrounding page
 * structure.
 */
export default function CustomerTicketsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="h-8 w-40 animate-pulse rounded-md bg-neutral-200 dark:bg-neutral-700" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded-md bg-neutral-200 dark:bg-neutral-700" />
      </div>

      <CustomerTicketListSkeleton />
    </div>
  );
}
