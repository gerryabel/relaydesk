'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Customer ticket search (Phase 9 Task 2).
 *
 * A plain GET form over the customer's own ticket list. It is deliberately a
 * client-side component with local state rather than a controlled input, so
 * typing does not push a history entry per keystroke and the result is a
 * real, shareable, server-rendered URL.
 *
 * The search term is matched server-side against title and description only.
 */
export function CustomerTicketSearch({
  workspaceSlug,
  initialQuery,
}: {
  workspaceSlug: string;
  initialQuery: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = query.trim();
    const search = trimmed.length > 0 ? `?q=${encodeURIComponent(trimmed)}` : '';

    router.push(`/portal/${workspaceSlug}/tickets${search}`);
  }

  return (
    <form onSubmit={submit} role="search" className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="customer-ticket-search" className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          Search my tickets
        </label>
        <input
          id="customer-ticket-search"
          name="q"
          type="search"
          value={query}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by subject or details"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 transition placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-100"
        />
      </div>
      <button
        type="submit"
        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 transition hover:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:border-neutral-100"
      >
        Search
      </button>
      {initialQuery ? (
        <button
          type="button"
          onClick={() => {
            setQuery('');
            router.push(`/portal/${workspaceSlug}/tickets`);
          }}
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          Clear
        </button>
      ) : null}
    </form>
  );
}
