import { notFound, redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CustomerLoginForm } from '@/components/portal/customer-login-form';
import { getCurrentCustomerSession, resolveWorkspaceBySlug } from '@/lib/customer-portal/session';
import { workspaceSlugSchema } from '@/lib/workspace/slug';

/**
 * Customer sign-in (Phase 9 Task 2).
 *
 * Passwordless, delegating entirely to the Task 1 magic-link endpoint. This
 * page owns no authentication logic of its own: the same primitives decide
 * whether a visitor needs to be here, and the same endpoint decides whether a
 * link is issued.
 *
 * A visitor who is already signed in to *this* workspace is sent to their
 * tickets. A visitor signed in to a *different* workspace is not "already
 * signed in" as far as this workspace is concerned, and gets the form — the
 * header sign-out control is how they switch.
 */
export default async function CustomerLoginPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const slug = workspaceSlugSchema.safeParse(workspaceSlug);

  if (!slug.success) {
    // The layout resolves the workspace for every portal request, so this is
    // only reachable if the routing layer and the schema disagree. Fail as a
    // 404 rather than looping back into `/login`.
    notFound();
  }

  const workspace = await resolveWorkspaceBySlug(slug.data);
  const session = await getCurrentCustomerSession();

  if (session && session.workspaceId === workspace.id) {
    redirect(`/portal/${workspace.slug}/tickets`);
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
          Sign in to your support portal
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          We will email you a secure sign-in link. There is no password to remember.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Request a sign-in link</CardTitle>
          <CardDescription>
            Use the email address your support requests were sent to.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomerLoginForm workspaceSlug={workspace.slug} />
        </CardContent>
      </Card>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Trouble signing in? Reply to any email from {workspace.name} and a support agent will
        help.
      </p>
    </div>
  );
}
