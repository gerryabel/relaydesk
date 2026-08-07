import { getDashboardStats } from '@/lib/dashboard/server';
import Link from 'next/link';

export default async function DashboardPage() {
  const stats = await getDashboardStats();
  const total = stats.open + stats.inProgress + stats.resolved + stats.closed;

  const cards = [
    { label: 'Open', value: stats.open, href: '/dashboard/tickets', color: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
    { label: 'In Progress', value: stats.inProgress, href: '/dashboard/tickets', color: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
    { label: 'Resolved', value: stats.resolved, href: '/dashboard/tickets', color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
    { label: 'Closed', value: stats.closed, href: '/dashboard/tickets', color: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300' },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Ringkasan tiket di workspace kamu.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <Link
              key={card.label}
              href={card.href}
              className={`rounded-lg border border-neutral-200 p-4 transition hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700 ${card.color}`}
            >
              <p className="text-sm font-medium">{card.label}</p>
              <p className="mt-2 text-3xl font-semibold">{card.value}</p>
            </Link>
          ))}
        </section>

        {total === 0 ? (
          <section className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
            Belum ada tiket. Buat tiket pertama kamu untuk memulai.
          </section>
        ) : null}
      </div>
    </div>
  );
}
