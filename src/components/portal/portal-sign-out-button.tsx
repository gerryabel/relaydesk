'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Customer sign-out (Phase 9 Task 2).
 *
 * Calls the Task 1 logout endpoint, which revokes the session server-side and
 * clears the HttpOnly cookie. The page cannot clear the cookie itself — it is
 * `HttpOnly` — so the round trip is what actually ends the session. A failure
 * still navigates to the login page: the cookie is cleared by the endpoint's
 * response regardless.
 */
export function PortalSignOutButton({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);

    try {
      await fetch(`/api/portal/${encodeURIComponent(workspaceSlug)}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
    } catch {
      // Deliberately swallowed: the redirect below is what the customer asked
      // for, and the endpoint clears the cookie on every path it can serve.
    }

    router.replace(`/portal/${workspaceSlug}/login`);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      aria-busy={pending}
      className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-900 transition hover:border-neutral-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-50 dark:hover:border-neutral-100"
    >
      {pending ? 'Signing out...' : 'Sign out'}
    </button>
  );
}
