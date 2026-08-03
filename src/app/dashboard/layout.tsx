import { redirect } from 'next/navigation';
import { getCurrentMembership, ForbiddenError } from '@/lib/workspace/server';
import Sidebar from '@/components/dashboard/sidebar';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await getCurrentMembership();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      redirect('/app/setup');
    }

    redirect('/login');
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 bg-neutral-50 dark:bg-neutral-950">
        {children}
      </main>
    </div>
  );
}
