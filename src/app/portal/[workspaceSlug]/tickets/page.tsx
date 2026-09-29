import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CustomerTicketList } from '@/components/portal/customer-ticket-list';
import { CustomerTicketSearch } from '@/components/portal/customer-ticket-search';
import { withPortalSession } from '@/lib/customer-portal/guards';
import { listCustomerTickets } from '@/lib/customer-portal/server';
import {
  normalizeCustomerTicketListParams,
  normalizeCustomerTicketSearch,
} from '@/lib/customer-portal/schema';

/**
 * "My tickets" (Phase 9 Task 2).
 *
 * Read server-side. `listCustomerTickets` returns only the customer's own
 * tickets, scoped in SQL by `(workspaceId, customerId)` resolved from the
 * session, so this page has no filtering to get wrong and no way to render
 * another customer's row.
 *
 * `withPortalSession` only turns an authorization failure into a redirect to
 * sign-in; the authorization itself happens inside the service, which is the
 * same boundary the REST route uses. A visitor who is not signed in is
 * therefore never shown an empty list that would read as "you have no
 * tickets".
 */
export default async function CustomerTicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const search = normalizeCustomerTicketListParams(await searchParams);
  const query = normalizeCustomerTicketSearch(search.q);
  const isFiltered = query !== undefined || search.status !== undefined;

  const result = await withPortalSession(workspaceSlug, () =>
    listCustomerTickets({ workspaceSlug, params: search }),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            My tickets
          </h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            {isFiltered
              ? `${result.total} ticket${result.total === 1 ? '' : 's'} found.`
              : 'Support requests you have opened with this team.'}
          </p>
        </div>

        <Button href={`/portal/${workspaceSlug}/tickets/new`}>New ticket</Button>
      </div>

      <CustomerTicketSearch workspaceSlug={workspaceSlug} initialQuery={query ?? ''} />

      {result.data.length === 0 ? (
        <EmptyState workspaceSlug={workspaceSlug} filtered={isFiltered} />
      ) : (
        <CustomerTicketList tickets={result.data} workspaceSlug={workspaceSlug} />
      )}

      {result.totalPages > 1 ? (
        <Pagination
          workspaceSlug={workspaceSlug}
          page={result.page}
          totalPages={result.totalPages}
          hasPreviousPage={result.hasPreviousPage}
          hasNextPage={result.hasNextPage}
          query={search.q}
        />
      ) : null}
    </div>
  );
}

/**
 * The empty state distinguishes "you have never opened a ticket" from "your
 * search matched nothing", because those are different problems and the
 * second one is fixed by clearing the filter rather than by opening a ticket.
 */
function EmptyState({
  workspaceSlug,
  filtered,
}: {
  workspaceSlug: string;
  filtered: boolean;
}) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-12 text-center dark:border-neutral-700 dark:bg-neutral-900">
      {filtered ? (
        <>
          <h2 className="text-base font-medium text-neutral-900 dark:text-neutral-50">
            No matching tickets
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-600 dark:text-neutral-300">
            Try a different search term, or clear the filter to see all of your tickets.
          </p>
          <div className="mt-4 flex justify-center">
            <Button href={`/portal/${workspaceSlug}/tickets`} variant="secondary">
              Clear search
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 className="text-base font-medium text-neutral-900 dark:text-neutral-50">
            You have not opened any tickets yet
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-600 dark:text-neutral-300">
            When you contact our support team, your requests will appear here so you can follow
            their progress.
          </p>
          <div className="mt-4 flex justify-center">
            <Button href={`/portal/${workspaceSlug}/tickets/new`}>Open a ticket</Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Page links are real URLs carrying the current search term, so a page of
 * results can be bookmarked or shared. Disabled edges are rendered as inert
 * `aria-disabled` spans rather than links: a focusable element that goes
 * nowhere is a keyboard trap, and removing it from the tab order entirely
 * would make the pagination's existence undiscoverable.
 */
function Pagination({
  workspaceSlug,
  page,
  totalPages,
  hasPreviousPage,
  hasNextPage,
  query,
}: {
  workspaceSlug: string;
  page: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  query: string | undefined;
}) {
  function hrefFor(targetPage: number) {
    const search = new URLSearchParams();

    if (query) {
      search.set('q', query);
    }

    search.set('page', String(targetPage));

    return `/portal/${workspaceSlug}/tickets?${search.toString()}`;
  }

  const edgeClasses =
    'rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-900 transition hover:border-neutral-900 dark:border-neutral-700 dark:text-neutral-50 dark:hover:border-neutral-100';
  const disabledEdgeClasses =
    'rounded-md border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-400 dark:border-neutral-800 dark:text-neutral-600';

  return (
    <nav
      aria-label="Ticket list pages"
      className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between"
    >
      <p className="text-xs text-neutral-600 dark:text-neutral-300">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-2">
        {hasPreviousPage ? (
          <Link href={hrefFor(page - 1)} className={edgeClasses} rel="prev">
            Previous
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledEdgeClasses}>
            Previous
          </span>
        )}

        {hasNextPage ? (
          <Link href={hrefFor(page + 1)} className={edgeClasses} rel="next">
            Next
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledEdgeClasses}>
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
