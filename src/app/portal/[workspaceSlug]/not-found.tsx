import Link from 'next/link';

/**
 * Not-found state for the whole portal segment (Phase 9 Task 2).
 *
 * Covers an unknown workspace slug, a malformed one, and a ticket that is not
 * the customer's. The copy is deliberately identical in all three cases and
 * names no ticket reference, so a customer cannot tell "this workspace does
 * not exist" from "this ticket is not yours" from "this ticket does not
 * exist".
 */
export default function PortalNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
        We could not find that page
      </h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        The link may be out of date, or the page may belong to a different workspace.
      </p>
      <Link
        href="/"
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-900 transition hover:border-neutral-900 dark:border-neutral-700 dark:text-neutral-50 dark:hover:border-neutral-100"
      >
        Go to the portal home page
      </Link>
    </div>
  );
}
