'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';

const STATUS_OPTIONS = [
  { value: '', label: 'Semua status' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
] as const;

const PRIORITY_OPTIONS = [
  { value: '', label: 'Semua prioritas' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;

export type TicketFilterControlsProps = {
  controlsClassName?: string;
  members?: Array<{ id: string; name: string; email: string }>;
};

function buildQueryString(
  searchParams: ReturnType<typeof useSearchParams>,
  nextSearch: string,
  nextStatus: string,
  nextPriority: string,
  nextAssignee: string
) {
  const params = new URLSearchParams(searchParams.toString());

  if (!nextSearch) {
    params.delete('search');
  } else {
    params.set('search', nextSearch);
  }

  if (!nextStatus) {
    params.delete('status');
  } else {
    params.set('status', nextStatus);
  }

  if (!nextPriority) {
    params.delete('priority');
  } else {
    params.set('priority', nextPriority);
  }

  if (!nextAssignee) {
    params.delete('assignee');
  } else {
    params.set('assignee', nextAssignee);
  }

  return params.toString();
}

export default function TicketFilterControls({ controlsClassName, members }: TicketFilterControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const search = searchParams.get('search') ?? '';
  const status = searchParams.get('status') ?? '';
  const priority = searchParams.get('priority') ?? '';
  const assignee = searchParams.get('assignee') ?? '';

  return (
    <form
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${controlsClassName ?? ''}`}
      onSubmit={(event) => event.preventDefault()}
      aria-label="Filter tiket"
    >
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600 dark:text-neutral-300">Pencarian</span>
          <input
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-100"
            placeholder="Cari tiket..."
            defaultValue={search}
            onChange={(event) => {
              const query = buildQueryString(searchParams, event.target.value, status, priority, assignee);
              router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
            }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600 dark:text-neutral-300">Status</span>
          <select
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-100"
            defaultValue={status}
            onChange={(event) => {
              const query = buildQueryString(searchParams, search, event.target.value, priority, assignee);
              router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600 dark:text-neutral-300">Prioritas</span>
          <select
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-100"
            defaultValue={priority}
            onChange={(event) => {
              const query = buildQueryString(searchParams, search, status, event.target.value, assignee);
              router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
            }}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600 dark:text-neutral-300">Assignee</span>
          <select
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-100"
            defaultValue={assignee}
            onChange={(event) => {
              const query = buildQueryString(searchParams, search, status, priority, event.target.value);
              router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
            }}
          >
            <option value="">Semua assignee</option>
            {(members ?? []).map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </form>
  );
}
