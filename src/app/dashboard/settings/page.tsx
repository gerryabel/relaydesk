import { getWorkspaceSettings } from '@/lib/workspace/settings';
import { getWorkspaceSlaPolicies } from '@/lib/workspace/sla-policy';
import { getCurrentMembership } from '@/lib/workspace/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import WorkspaceNameForm from '@/components/workspace/workspace-name-form';
import SlaPolicyForm from '@/components/workspace/sla-policy-form';
import { DashboardErrorState } from '@/components/ui/error-state';

export default async function SettingsPage() {
  let currentRole: 'owner' | 'member';
  let settings: { id: string; name: string };
  let slaPolicies: Awaited<ReturnType<typeof getWorkspaceSlaPolicies>>;

  try {
    const membership = await getCurrentMembership();
    currentRole = membership.role;
    settings = await getWorkspaceSettings();
    slaPolicies = await getWorkspaceSlaPolicies();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-10">
          <DashboardErrorState message="Please sign in to view workspace settings." />
        </div>
      );
    }
    if (error instanceof ForbiddenError) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-10">
          <DashboardErrorState message="You need a workspace to view workspace settings." />
        </div>
      );
    }
    throw error;
  }

  const canEdit = currentRole === 'owner';

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Configure your workspace.
          </p>
        </header>

        <WorkspaceNameForm initialName={settings.name} canEdit={canEdit} />

        <SlaPolicyForm policies={slaPolicies} canEdit={canEdit} />
      </div>
    </div>
  );
}
