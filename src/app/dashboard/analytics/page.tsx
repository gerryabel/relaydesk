import { getAnalytics } from '@/lib/analytics/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import AnalyticsView from '@/components/analytics/analytics-view';
import { DashboardErrorState } from '@/components/ui/error-state';
import type { SearchParams } from 'next/dist/server/request/search-params';

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function AnalyticsPage({ searchParams }: PageProps) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-10">
          <DashboardErrorState message="Please sign in to view analytics." />
        </div>
      );
    }
    if (error instanceof ForbiddenError) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-10">
          <DashboardErrorState message="You need a workspace to view analytics." />
        </div>
      );
    }
    throw error;
  }

  const params = await searchParams;
  const from = typeof params.from === 'string' ? params.from : undefined;
  const to = typeof params.to === 'string' ? params.to : undefined;

  const data = await getAnalytics({ from, to });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Operational analytics for this workspace. Metrics are split into period-based (bound to the selected date range) and current-snapshot (state at query time). All dates and boundaries are UTC.
          </p>
        </header>

        <AnalyticsView data={data} />
      </div>
    </div>
  );
}
