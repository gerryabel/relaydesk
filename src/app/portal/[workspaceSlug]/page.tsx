import { notFound, redirect } from 'next/navigation';
import { workspaceSlugSchema } from '@/lib/workspace/slug';
import {
  getCurrentCustomerSession,
  resolveWorkspaceBySlug,
  WorkspaceSlugNotFoundError,
} from '@/lib/customer-portal/session';

/**
 * Portal entry point (Phase 9 Task 2).
 *
 * `/portal/{workspaceSlug}` is an entry point, not a page: a customer with a
 * valid session for this workspace lands on their tickets, and everyone else
 * lands on the sign-in form. The decision comes from the server-resolved
 * session, never from anything the client controls.
 *
 * A session belonging to a different workspace counts as signed out here — it
 * authorizes nothing for this workspace, and answering "forbidden" would
 * confirm to a stranger that the slug they guessed is real.
 */
export default async function PortalEntryPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const slug = workspaceSlugSchema.safeParse(workspaceSlug);

  if (!slug.success) {
    notFound();
  }

  let workspace = null;

  try {
    workspace = await resolveWorkspaceBySlug(slug.data);
  } catch (error) {
    if (!(error instanceof WorkspaceSlugNotFoundError)) {
      throw error;
    }
  }

  if (!workspace) {
    notFound();
  }

  const session = await getCurrentCustomerSession();

  if (session && session.workspaceId === workspace.id) {
    redirect(`/portal/${workspace.slug}/tickets`);
  }

  redirect(`/portal/${workspace.slug}/login`);
}
