'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface RetryActionButtonProps {
  executionId: string;
  actionIndex: number;
  disabled?: boolean;
}

/**
 * Owner-only manual retry trigger.
 *
 * Posts to the retry API; the service — not this component — decides whether
 * the action is eligible, so hiding the control is only a usability affordance.
 * Authorization is enforced server-side on every request.
 */
export function RetryActionButton({ executionId, actionIndex, disabled }: RetryActionButtonProps) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRetry = async () => {
    setError(null);
    setIsRetrying(true);

    try {
      const response = await fetch(
        `/api/automation-executions/${encodeURIComponent(executionId)}/actions/${actionIndex}/retry`,
        { method: 'POST' },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Retry failed (${response.status}).`);
        return;
      }

      router.refresh();
    } catch {
      setError('Retry failed: could not reach the server.');
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleRetry}
        disabled={disabled || isRetrying}
        className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:border-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:border-neutral-100"
      >
        {isRetrying ? 'Retrying…' : 'Retry action'}
      </button>
      {error ? (
        <p className="text-xs text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
