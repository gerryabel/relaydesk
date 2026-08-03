'use client';

import { type ComponentPropsWithoutRef } from 'react';

type BadgeProps = ComponentPropsWithoutRef<'span'> & {
  tone?: 'neutral' | 'blue' | 'amber' | 'emerald' | 'red';
};

const tones: Record<string, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
};

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className ?? ''}`}
      {...props}
    />
  );
}
