'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SignOutButton from '@/components/auth/sign-out-button';

const navigation = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/tickets', label: 'Tickets' },
  { href: '/dashboard/tags', label: 'Tags' },
  { href: '/dashboard/members', label: 'Members' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex h-14 items-center border-b border-neutral-200 px-4 dark:border-neutral-800">
        <Link href="/dashboard" className="text-lg font-semibold">
          RelayDesk
        </Link>
      </div>
      <nav className="flex-1 px-2 py-4" aria-label="Dashboard">
        <ul className="flex flex-col gap-1">
          {navigation.map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-md px-3 py-2 text-sm transition ${
                    isActive
                      ? 'bg-neutral-100 font-medium dark:bg-neutral-800'
                      : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-neutral-200 p-2 dark:border-neutral-800">
        <SignOutButton />
      </div>
    </aside>
  );
}
