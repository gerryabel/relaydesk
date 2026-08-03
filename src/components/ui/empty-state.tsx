'use client';

import { type ComponentPropsWithoutRef } from 'react';

type EmptyStateProps = ComponentPropsWithoutRef<'div'> & {
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function EmptyState({ title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={`rounded-lg border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700 ${className ?? ''}`}
      {...props}
    >
      <div className="mx-auto max-w-sm">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{title}</p>
        {description ? (
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{description}</p>
        ) : null}
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}
