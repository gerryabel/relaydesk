'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

/**
 * Route-segment error boundary for the ticket list (Phase 9 Task 2).
 *
 * Scoped to this segment so a failure while listing tickets does not take the
 * sign-in or verify pages down with it.
 *
 * Next.js requires `error.tsx` to be a client component. The caught error is
 * sent to the console for the operator and never rendered: it can carry a
 * Prisma or driver message, and this page is customer-facing. The customer
 * sees a fixed literal and a way forward.
 *
 * `reset()` re-runs the failed render. The workspace slug comes from the
 * client router state, not from `error.digest` — the digest is an opaque hash
 * and the back-off link is only a convenience, so the router's own copy of the
 * current segment is enough.
 */
export default function CustomerTicketsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ workspaceSlug: string }>();
  const workspaceSlug = params?.workspaceSlug ?? '';

  useEffect(() => {
    console.error('Customer portal tickets failed to load', error);
  }, [error]);

  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-900 dark:bg-red-950/40"
    >
      <p className="text-sm font-medium text-red-900 dark:text-red-100">
        We could not load your tickets right now. Please try again.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        {workspaceSlug ? (
          <Button href={`/portal/${workspaceSlug}/tickets`} variant="secondary">
            Back to my tickets
          </Button>
        ) : null}
      </div>
    </div>
  );
}
