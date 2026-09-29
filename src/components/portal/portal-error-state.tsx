import { Button } from '@/components/ui/button';

/**
 * Customer-facing error state (Phase 9 Task 2).
 *
 * A portal counterpart to the internal dashboard's `DashboardErrorState`, which
 * is Indonesian and named for the dashboard. Reused by the new-ticket page,
 * where a create that fails after the form is submitted needs somewhere to put
 * the customer other than back on an empty form.
 *
 * The message is a fixed literal chosen here, never a rendered exception: an
 * unexpected portal failure can carry database, SLA-policy or outbox detail in
 * its message, and none of that belongs on a page a customer is reading.
 */
export function PortalErrorState({
  workspaceSlug,
  message = 'We could not load this right now. Please try again.',
}: {
  workspaceSlug: string;
  message?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-900 dark:bg-red-950/40"
    >
      <p className="text-sm font-medium text-red-900 dark:text-red-100">{message}</p>
      <div className="mt-4 flex justify-center">
        <Button href={`/portal/${workspaceSlug}/tickets`} variant="secondary">
          Back to my tickets
        </Button>
      </div>
    </div>
  );
}
