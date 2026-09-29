import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PublicWorkspace } from '@/lib/customer-portal/session';

/**
 * Customer portal shell (Phase 9 Task 2).
 *
 * Deliberately distinct from the internal dashboard layout: a single centred
 * column with a workspace-branded header, no sidebar, no internal
 * navigation. A customer should not be able to see the shape of the agent
 * workspace even in outline — a sidebar is a promise that there is more to
 * click, and most of it would be internal.
 *
 * It reuses the same primitives (neutral palette, `Card`, `Badge`, dark-mode
 * tokens) so the portal reads as part of RelayDesk.
 */

export function PortalShell({
  workspace,
  authSlot,
  children,
}: {
  workspace: PublicWorkspace;
  /** Authentication state, rendered on the right of the header. */
  authSlot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950">
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg dark:focus:bg-neutral-900"
      >
        Skip to content
      </a>

      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col">
            <Link
              href={`/portal/${workspace.slug}`}
              className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
            >
              Support portal
            </Link>
            <p className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-50">
              {workspace.name}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3 text-sm">{authSlot}</div>
        </div>
      </header>

      <main id="portal-main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        {children}
      </main>

      <footer className="border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto w-full max-w-4xl px-4 py-4 text-xs text-neutral-500 dark:text-neutral-400">
          You are viewing the support portal for {workspace.name}.
        </div>
      </footer>
    </div>
  );
}

/**
 * Signed-in header state.
 *
 * Shows the sign-in address and a logout control. No user id, no session id,
 * no membership — the only identity the customer sees is the email they
 * signed in with.
 */
export function PortalAuthState({
  workspaceSlug,
  email,
  signOut,
}: {
  workspaceSlug: string;
  email: string;
  signOut: ReactNode;
}) {
  return (
    <>
      <span className="hidden text-neutral-600 sm:inline dark:text-neutral-300">{email}</span>
      <nav aria-label="Portal">
        <Link
          href={`/portal/${workspaceSlug}/tickets`}
          className="rounded-md px-2 py-1.5 font-medium text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          My tickets
        </Link>
      </nav>
      {signOut}
    </>
  );
}

/** Signed-out header state. */
export function PortalSignedOutState({ workspaceSlug }: { workspaceSlug: string }) {
  return (
    <Link
      href={`/portal/${workspaceSlug}/login`}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-900 transition hover:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:border-neutral-100"
    >
      Sign in
    </Link>
  );
}
