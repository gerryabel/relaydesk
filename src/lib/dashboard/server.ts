import { prisma } from '@/lib/db/prisma';
import { getCurrentWorkspace } from '@/lib/workspace/server';

export type DashboardStats = {
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const workspace = await getCurrentWorkspace();

  const counts = await prisma.ticket.groupBy({
    by: ['status'],
    where: { workspaceId: workspace.id },
    _count: { status: true },
  });

  const stats: DashboardStats = {
    open: 0,
    inProgress: 0,
    resolved: 0,
    closed: 0,
  };

  for (const row of counts) {
    const count = row._count.status;
    switch (row.status) {
      case 'open':
        stats.open = count;
        break;
      case 'in_progress':
        stats.inProgress = count;
        break;
      case 'resolved':
        stats.resolved = count;
        break;
      case 'closed':
        stats.closed = count;
        break;
    }
  }

  return stats;
}
