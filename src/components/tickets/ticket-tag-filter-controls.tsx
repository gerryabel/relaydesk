'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

const TAG_OPTIONS = [
  { value: '', label: 'Semua tag' },
];

export type TicketTagFilterControlsProps = {
  tags: Array<{ id: string; name: string }>;
  controlsClassName?: string;
};

export default function TicketTagFilterControls({ tags, controlsClassName }: TicketTagFilterControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const tagId = searchParams.get('tagId') ?? '';
  const normalizedTagId = tags.some((item) => item.id === tagId) ? tagId : '';

  return (
    <label className={`flex flex-col gap-1 text-sm ${controlsClassName ?? ''}`}>
      <span className="text-neutral-600 dark:text-neutral-300">Tag</span>
      <select
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-100"
        defaultValue={normalizedTagId}
        disabled={isPending}
        aria-label="Filter tag"
        onChange={(event) => {
          const nextTagId = event.target.value;
          const params = new URLSearchParams(searchParams.toString());
          if (!nextTagId) {
            params.delete('tagId');
          } else {
            params.set('tagId', nextTagId);
          }
          startTransition(() => {
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          });
        }}
      >
        {TAG_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {tags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.name}
          </option>
        ))}
      </select>
    </label>
  );
}
