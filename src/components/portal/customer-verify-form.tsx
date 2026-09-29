'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readCustomerPortalErrorMessage } from '@/lib/customer-portal/http';

/**
 * Magic-link verification (Phase 9 Task 2).
 *
 * Posts the token straight to the Task 1 verification endpoint, which
 * consumes it and returns the customer session **only** as an HttpOnly cookie.
 * The component never reads, stores or prints the session token — it cannot;
 * the cookie is invisible to script — and it never logs the magic-link token.
 * The raw token lives only in this component's closure and in the POST body,
 * for exactly as long as the request takes.
 */

type VerifyState = 'submitting' | 'failed';

export function CustomerVerifyForm({
  workspaceSlug,
  token,
}: {
  workspaceSlug: string;
  token: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<VerifyState>('submitting');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    // React 18 strict mode remounts effects in development. Without this guard
    // a single-use magic link would be submitted twice and the second attempt
    // would fail, showing the customer a spurious "invalid link".
    if (started.current) {
      return;
    }

    started.current = true;

    async function verify() {
      try {
        const response = await fetch(
          `/api/portal/${encodeURIComponent(workspaceSlug)}/auth/magic-link/verify`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token }),
          },
        );

        if (response.ok) {
          router.replace(`/portal/${workspaceSlug}/tickets`);
          router.refresh();
          return;
        }

        const payload: unknown = await response.json().catch(() => null);
        setState('failed');
        setMessage(readCustomerPortalErrorMessage(payload, 'This sign-in link is no longer valid.'));
      } catch {
        setState('failed');
        setMessage('We could not reach the portal. Please request a new sign-in link.');
      }
    }

    void verify();
  }, [router, token, workspaceSlug]);

  if (state === 'failed') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
        <p role="alert">{message}</p>
        <p className="mt-2">
          <a className="underline" href={`/portal/${workspaceSlug}/login`}>
            Request a new sign-in link
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
      <p role="status">Verifying your sign-in link...</p>
    </div>
  );
}
