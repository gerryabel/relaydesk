import { prisma } from '@/lib/db/prisma';
import { getCurrentMembership } from '@/lib/workspace/server';
import AutomationsPage from './client-page';

/**
 * Server component that fetches the data needed by the automations page
 * and renders the client-side AutomationsPage.
 */
export default async function AutomationsServerPage() {
  const membership = await getCurrentMembership();

  const [rules, members, tags] = await Promise.all([
    prisma.automationRule.findMany({
      where: { workspaceId: membership.workspaceId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.membership.findMany({
      where: { workspaceId: membership.workspaceId },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.tag.findMany({
      where: { workspaceId: membership.workspaceId },
      select: { id: true, name: true },
    }),
  ]);

  const isOwner = membership.role === 'owner';

  const serializedRules = rules.map((rule) => ({
    id: rule.id,
    workspaceId: rule.workspaceId,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    priority: rule.priority,
    triggerType: rule.triggerType,
    conditions: rule.conditions,
    actions: rule.actions,
    createdById: rule.createdById,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }));

  const serializedMembers = members.map((m) => ({
    id: m.user.id,
    name: m.user.name ?? m.user.id,
  }));

  return (
    <AutomationsPage
      isOwner={isOwner}
      initialRules={serializedRules}
      members={serializedMembers}
      tags={tags}
    />
  );
}
