import { getMembers } from '@/lib/members/server';
import { getCurrentMembership } from '@/lib/workspace/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import MemberList from '@/components/members/member-list';
import { EmptyState } from '@/components/ui/empty-state';
import { DashboardErrorState } from '@/components/ui/error-state';

export default async function MembersPage() {
  let currentRole: 'owner' | 'member';

  try {
    const membership = await getCurrentMembership();
    currentRole = membership.role;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-10">
          <DashboardErrorState message="Please sign in to view members." />
        </div>
      );
    }
    if (error instanceof ForbiddenError) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-10">
          <DashboardErrorState message="You need a workspace to view members." />
        </div>
      );
    }
    throw error;
  }

  const members = await getMembers();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Members</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Manage workspace members and their roles.
          </p>
        </header>
        {members.length === 0 ? (
          <EmptyState
            title="No members"
            description="This workspace has no members yet."
          />
        ) : (
          <MemberList members={members} currentUserRole={currentRole} />
        )}
      </div>
    </div>
  );
}
