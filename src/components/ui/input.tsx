'use client';

import { type ComponentPropsWithoutRef } from 'react';

const field =
  'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 transition placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-100 disabled:cursor-not-allowed disabled:opacity-60';

export function Input({ className, ...props }: ComponentPropsWithoutRef<'input'>) {
  return <input className={[field, className].filter(Boolean).join(' ')} {...props} />;
}
