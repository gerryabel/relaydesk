'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { TICKET_SORT_FIELD_OPTIONS, TICKET_SORT_DIRECTION_OPTIONS } from '@/lib/tickets/sort';

export type TicketSortControlsProps = {
  controlsClassName?: string;
};

function buildQueryString(
  searchParams: ReturnType<typeof useSearchParams>,
  nextField: string,
  nextDirection: string
) {
  const params = new URLSearchParams(searchParams.toString());

  if (!nextField) {
    params.delete('sort');
  } else {
    params.set('sort', nextField);
  }

  if (params.get('sort')) {
    const direction = TICKET_SORT_DIRECTION_OPTIONS.some((option) => option.value === nextDirection) ? nextDirection : 'desc';
    params.set('sort', `${params.get('sort')}:${direction}`);
  }

  return params.toString();
}

export default function TicketSortControls({ controlsClassName }: TicketSortControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const rawSort = searchParams.get('sort') ?? '';
  const [field, direction] = rawSort.includes(':') ? rawSort.split(':') : [rawSort || 'createdAt', 'desc'];
  const normalizedField = TICKET_SORT_FIELD_OPTIONS.some((option) => option.value === field) ? field : 'createdAt';
  const normalizedDirection = TICKET_SORT_DIRECTION_OPTIONS.some((option) => option.value === direction) ? direction : 'desc';

  return (
    <form
      className={`flex flex-col gap-3 sm:flex-row sm:items-center ${controlsClassName ?? ''}`}
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-600 dark:text-neutral-300">Urutkan</span>
        <select
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-100"
          defaultValue={normalizedField}
          onChange={(event) => {
            const query = buildQueryString(searchParams, event.target.value, normalizedDirection);
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
          }}
        >
          {TICKET_SORT_FIELD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-600 dark:text-neutral-300">Arah</span>
        <select
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-100"
          defaultValue={normalizedDirection}
          onChange={(event) => {
            const query = buildQueryString(searchParams, normalizedField, event.target.value);
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
          }}
        >
          {TICKET_SORT_DIRECTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
