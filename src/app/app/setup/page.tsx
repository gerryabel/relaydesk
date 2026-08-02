import { redirect } from 'next/navigation';
import { getServerAuthSession } from '@/lib/auth/session';
import { getDefaultWorkspace } from '@/lib/workspace/server';
import { createDefaultWorkspace } from './actions';

export default async function SetupPage() {
  const session = await getServerAuthSession();

  if (!session?.user) {
    redirect('/login');
  }

  const membership = await getDefaultWorkspace(session.user.id);

  if (membership) {
    redirect('/app');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4">
      <section className="flex w-full flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-6 text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50">
        <h1 className="text-xl font-semibold">Setup workspace</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Buat workspace default agar kamu bisa mulai menggunakan RelayDesk.
        </p>
        <form action={createDefaultWorkspace} className="flex flex-col gap-3">
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Create workspace
          </button>
        </form>
      </section>
    </main>
  );
}
