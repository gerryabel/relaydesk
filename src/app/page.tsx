import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4">
      <div className="flex max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">RelayDesk</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            One inbox. Every customer conversation.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/login"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-center text-sm font-medium transition hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-neutral-900 px-4 py-2 text-center text-sm font-medium text-white transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Create account
          </Link>
        </div>
      </div>
    </main>
  );
}
