import { CustomerVerifyForm } from '@/components/portal/customer-verify-form';
import { resolveWorkspaceBySlug } from '@/lib/customer-portal/session';
import { workspaceSlugSchema } from '@/lib/workspace/slug';
import { notFound } from 'next/navigation';

/**
 * Magic-link verification (Phase 9 Task 2).
 *
 * The link target named by Task 1's mailer, and the only page that reads a
 * `token` search parameter.
 *
 * The token is handed straight to a client component that POSTs it to the
 * Task 1 verification endpoint. It is never rendered, never echoed into the
 * page, and never logged. This page does not call the verification service
 * itself, because doing so from a server component would consume the
 * single-use token during a render that Next.js may perform speculatively —
 * on a client navigation, on a prefetch, or on a React strict-mode double
 * render — leaving the customer's subsequent real request holding a token
 * that is already spent.
 *
 * The session token is likewise never touched here. The verify endpoint
 * returns it only as an `HttpOnly` cookie, so "signed in" is a server fact,
 * not something this page can read or hand around.
 */
export default async function CustomerVerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const slug = workspaceSlugSchema.safeParse(workspaceSlug);

  if (!slug.success) {
    notFound();
  }

  const workspace = await resolveWorkspaceBySlug(slug.data);
  const params_ = await searchParams;
  const rawToken = params_.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
          Signing you in
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          One moment while we confirm your sign-in link for {workspace.name}.
        </p>
      </div>

      {token && token.length > 0 ? (
        <CustomerVerifyForm workspaceSlug={workspace.slug} token={token} />
      ) : (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <p>This sign-in link is missing its token.</p>
          <p className="mt-2">
            <a className="underline" href={`/portal/${workspace.slug}/login`}>
              Request a new sign-in link
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
