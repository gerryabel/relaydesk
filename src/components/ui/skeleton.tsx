'use client';

import { type ComponentPropsWithoutRef } from 'react';

type SkeletonProps = ComponentPropsWithoutRef<'div'> & {
  variant?: 'text' | 'rect' | 'circle';
};

const variantClasses: Record<NonNullable<SkeletonProps['variant']>, string> = {
  text: 'h-4 w-full rounded-md',
  rect: 'h-24 w-full rounded-lg',
  circle: 'h-12 w-12 rounded-full',
};

const fallbackVariant = 'text';

export function Skeleton({ variant = fallbackVariant, className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-neutral-200 dark:bg-neutral-700 ${variantClasses[variant]} ${className ?? ''}`}
      {...props}
    />
  );
}
