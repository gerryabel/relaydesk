'use client';

import { useId, useState } from 'react';
import { readCustomerPortalErrorMessage } from '@/lib/customer-portal/http';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Customer sign-in form (Phase 9 Task 2).
 *
 * Posts to the Task 1 magic-link endpoint and renders **only** the endpoint's
 * generic response. The customer is never told whether the address is
 * registered, and no local pre-check of the email address is performed — any
 * such check would reintroduce the enumeration the endpoint is built to avoid.
 */

type FormState = 'idle' | 'submitting' | 'sent' | 'error';

export function CustomerLoginForm({ workspaceSlug }: { workspaceSlug: string }) {
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const [message, setMessage] = useState<string>('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('submitting');
    setMessage('');

    try {
      const response = await fetch(
        `/api/portal/${encodeURIComponent(workspaceSlug)}/auth/magic-link`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        },
      );

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setState('error');
        setMessage(readCustomerPortalErrorMessage(payload, 'We could not process that request.'));
        return;
      }

      setState('sent');
      setMessage(
        readCustomerPortalErrorMessage(payload, 'If that address can receive a sign-in link, one has been sent.'),
      );
    } catch {
      setState('error');
      setMessage('We could not reach the portal. Please check your connection and try again.');
    }
  }

  if (state === 'sent') {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
        <p role="status">{message}</p>
        <p className="mt-2 text-emerald-800 dark:text-emerald-200">
          Check your inbox for a sign-in link. It can be used once and expires shortly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate={false}>
      <div className="flex flex-col gap-2">
        <Label htmlFor={emailId}>Email address</Label>
        <Input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <p className="text-xs text-neutral-600 dark:text-neutral-300">
          We will email you a secure sign-in link. No password is needed.
        </p>
      </div>

      {state === 'error' && message ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={state === 'submitting'}
        aria-busy={state === 'submitting'}
        className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {state === 'submitting' ? 'Sending...' : 'Email me a sign-in link'}
      </button>
    </form>
  );
}
