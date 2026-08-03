'use client';

import NextLink from 'next/link';
import { type ReactNode } from 'react';

const variants = {
  primary:
    'bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200',
  secondary:
    'bg-neutral-100 text-neutral-900 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-50 dark:hover:bg-neutral-700',
  ghost:
    'bg-transparent text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800',
  danger:
    'bg-red-600 text-white hover:bg-red-500 dark:bg-red-500 dark:hover:bg-red-400',
};

const buttonClasses =
  'inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60';

type ButtonProps = {
  variant?: keyof typeof variants;
  className?: string;
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  onClick?: () => void | Promise<void>;
  children: ReactNode;
};

export function Button({ variant = 'primary', className, href, type = 'button', disabled, onClick, children }: ButtonProps) {
  const classes = [buttonClasses, variants[variant], className].filter(Boolean).join(' ');

  if (href) {
    return (
      <NextLink href={href} className={classes}>
        {children}
      </NextLink>
    );
  }

  return (
    <button type={type} disabled={disabled} onClick={onClick} className={classes}>
      {children}
    </button>
  );
}
