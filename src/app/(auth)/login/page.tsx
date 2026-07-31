import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = searchParams ? await searchParams : {};
  const error = typeof resolved?.error === "string" ? resolved.error : "";

  const session = await auth.api.getSession({ headers: {} });
  if (session?.user) {
    redirect("/app");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl items-center px-4">
      <div className="w-full max-w-sm">
        <form className="flex flex-col gap-4" action="/api/auth/all/login" method="POST">
          <legend className="text-xl font-semibold">Sign in to RelayDesk</legend>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Access your helpdesk workspace.
          </p>

          <label className="flex flex-col gap-2 text-sm font-medium">
            Email
            <input
              name="email"
              type="email"
              required
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Password
            <input
              name="password"
              type="password"
              required
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Sign in
          </button>

          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            No account yet?{" "}
            <a className="underline" href="/register">
              Create one
            </a>
          </p>
        </form>
      </div>
    </main>
  );
}
