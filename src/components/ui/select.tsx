'use client';

import { type ComponentPropsWithoutRef } from 'react';

const selectClasses =
  'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50';

export function Select({ className, ...props }: ComponentPropsWithoutRef<'select'>) {
  return <select className={[selectClasses, className].filter(Boolean).join(' ')} {...props} />;
}
