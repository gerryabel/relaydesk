import { getWorkload } from '@/lib/workload/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import AgentWorkloadView from '@/components/workload/agent-workload';
import { DashboardErrorState } from '@/components/ui/error-state';

export default async function WorkloadPage() {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-10">
          <DashboardErrorState message="Please sign in to view agent workload." />
        </div>
      );
    }
    if (error instanceof ForbiddenError) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-10">
          <DashboardErrorState message="You need a workspace to view agent workload." />
        </div>
      );
    }
    throw error;
  }

  const { members, summary } = await getWorkload();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Agent Workload</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            How currently assigned ticket work is distributed across workspace members. Metrics are based on tickets assigned in this workspace.
          </p>
        </header>

        <AgentWorkloadView members={members} summary={summary} />
      </div>
    </div>
  );
}
