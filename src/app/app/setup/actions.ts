'use server';

import { getServerAuthSession } from '@/lib/auth/session';
import { ensureDefaultWorkspace } from '@/lib/workspace/server';
import { redirect } from 'next/navigation';

export async function createDefaultWorkspace() {
  const session = await getServerAuthSession();

  if (!session?.user) {
    redirect('/login');
  }

  await ensureDefaultWorkspace(session.user.id);

  redirect('/app');
}
