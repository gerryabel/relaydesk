'use client';

import { type ComponentPropsWithoutRef } from 'react';

export function Label({ className, ...props }: ComponentPropsWithoutRef<'label'>) {
  return (
    <label
      className={`text-sm font-medium text-neutral-700 dark:text-neutral-200 ${className ?? ''}`}
      {...props}
    />
  );
}
