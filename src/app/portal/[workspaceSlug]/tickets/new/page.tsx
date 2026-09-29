import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { CustomerNewTicketForm } from '@/components/portal/customer-new-ticket-form';
import { requirePortalSession } from '@/lib/customer-portal/guards';

/**
 * New customer ticket (Phase 9 Task 2).
 *
 * The page authorizes before rendering the form, so an unsigned visitor is
 * redirected to sign-in instead of discovering their submission is rejected
 * after filling it in. The form's server action re-authorizes independently —
 * this guard is for the customer's experience, the action is for the boundary.
 */
export default async function CustomerNewTicketPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const session = await requirePortalSession(workspaceSlug);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <Link
          href={`/portal/${session.workspace.slug}/tickets`}
          className="text-sm text-neutral-600 underline-offset-2 hover:underline dark:text-neutral-300"
        >
          Back to my tickets
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
          Open a support ticket
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          Tell us what you need. Our team will reply here and by email.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 sm:p-6">
          <CustomerNewTicketForm workspaceSlug={session.workspace.slug} />
        </CardContent>
      </Card>
    </div>
  );
}
