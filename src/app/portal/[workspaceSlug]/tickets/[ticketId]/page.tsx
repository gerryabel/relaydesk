import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomerTicketDetailView } from '@/components/portal/customer-ticket-detail';
import { redirectPortalVisitorToLogin } from '@/lib/customer-portal/guards';
import { getCustomerTicket } from '@/lib/customer-portal/server';
import {
  CustomerTicketNotFoundError,
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
} from '@/lib/customer-portal/errors';
import type { CustomerTicketDetail } from '@/lib/customer-portal/dto';

/**
 * Customer ticket detail (Phase 9 Task 2).
 *
 * `getCustomerTicket` queries by `(id, workspaceId, customerId)` in a single
 * `findFirst`, so a ticket belonging to another customer — or to a customer in
 * another workspace — is simply not found rather than forbidden. That
 * distinction is the point: a `403` here would confirm the id is real.
 *
 * The two failure modes are therefore handled separately and deliberately:
 * an authorization failure is a sign-in redirect, while "not yours" renders the
 * same 404 as "no such ticket" and "no such workspace".
 */
export default async function CustomerTicketDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; ticketId: string }>;
}) {
  const { workspaceSlug, ticketId } = await params;

  let ticket: CustomerTicketDetail;

  try {
    ticket = await getCustomerTicket({ workspaceSlug, ticketId });
  } catch (error) {
    if (error instanceof CustomerTicketNotFoundError) {
      notFound();
    }

    if (
      error instanceof CustomerUnauthenticatedError ||
      error instanceof CustomerWorkspaceMismatchError
    ) {
      redirectPortalVisitorToLogin(workspaceSlug);
    }

    throw error;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Link
        href={`/portal/${workspaceSlug}/tickets`}
        className="text-sm text-neutral-600 underline-offset-2 hover:underline dark:text-neutral-300"
      >
        Back to my tickets
      </Link>

      <CustomerTicketDetailView ticket={ticket} workspaceSlug={workspaceSlug} />
    </div>
  );
}
