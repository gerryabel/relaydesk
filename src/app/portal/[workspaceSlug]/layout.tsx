import { notFound } from 'next/navigation';
import {
  getCurrentCustomerSession,
  resolveWorkspaceBySlug,
  WorkspaceSlugNotFoundError,
} from '@/lib/customer-portal/session';
import {
  PortalAuthState,
  PortalShell,
  PortalSignedOutState,
} from '@/components/portal/portal-shell';
import { PortalSignOutButton } from '@/components/portal/portal-sign-out-button';
import { workspaceSlugSchema } from '@/lib/workspace/slug';
import type { PublicWorkspace } from '@/lib/customer-portal/session';

/**
 * Customer portal layout (Phase 9 Task 2).
 *
 * Owns the two things every portal page needs and nothing more: the resolved
 * workspace identity, and whether the current session belongs to it.
 *
 * The header is not a security control — no page relies on it to hide
 * anything — but it is the honest answer to "where am I signed in", and it
 * gives the customer a logout control on every portal page.
 *
 * An unknown slug is a `404` here, before any session work: the portal does
 * not confirm that a workspace exists to a visitor who has not signed in.
 */
export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const slug = workspaceSlugSchema.safeParse(workspaceSlug);
  const workspace = slug.success ? await resolvePortalWorkspace(slug.data) : null;

  if (!workspace) {
    notFound();
  }

  return (
    <PortalShell workspace={workspace} authSlot={<PortalAuthSlot workspace={workspace} />}>
      {children}
    </PortalShell>
  );
}

async function resolvePortalWorkspace(slug: string): Promise<PublicWorkspace | null> {
  try {
    return await resolveWorkspaceBySlug(slug);
  } catch (error) {
    if (error instanceof WorkspaceSlugNotFoundError) {
      return null;
    }

    throw error;
  }
}

/**
 * Resolves the session for the header only.
 *
 * A missing, revoked, expired or wrong-workspace session renders the
 * signed-out state instead of throwing, because `/login` and `/verify` are
 * reachable without one. Individual pages authorize independently — this only
 * decides which header to draw.
 */
async function PortalAuthSlot({ workspace }: { workspace: PublicWorkspace }) {
  const session = await getCurrentCustomerSession();

  if (!session || session.workspaceId !== workspace.id) {
    return <PortalSignedOutState workspaceSlug={workspace.slug} />;
  }

  return (
    <PortalAuthState
      workspaceSlug={workspace.slug}
      email={session.email}
      signOut={<PortalSignOutButton workspaceSlug={workspace.slug} />}
    />
  );
}
