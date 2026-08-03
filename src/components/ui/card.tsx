'use client';

import { type ComponentPropsWithoutRef } from 'react';

type CardProps = ComponentPropsWithoutRef<'div'>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${className ?? ''}`}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: CardProps) {
  return <div className={`p-5 border-b border-neutral-200 dark:border-neutral-800 ${className ?? ''}`} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentPropsWithoutRef<'h2'>) {
  return <h2 className={`text-lg font-semibold ${className ?? ''}`} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentPropsWithoutRef<'p'>) {
  return <p className={`text-sm text-neutral-600 dark:text-neutral-300 ${className ?? ''}`} {...props} />;
}

export function CardContent({ className, ...props }: CardProps) {
  return <div className={`p-5 ${className ?? ''}`} {...props} />;
}
