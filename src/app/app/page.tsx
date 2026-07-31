import { auth } from "@/src/lib/auth/auth";
import { redirect } from "next/navigation";

export default async function AppPage() {
  const session = await auth.api.getSession({ headers: {} });

  if (!session?.user) {
    redirect("/login");
  }

  const user = session.user;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-6 text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50">
      <div>
        <h1 className="text-xl font-semibold">RelayDesk</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Signed in as:
          <span className="ml-2 font-medium">{user.name ?? "Unnamed"}</span>
        </p>
        <a
          className="text-sm text-neutral-600 underline dark:text-neutral-300"
          href={`mailto:${user.email}`}
        >
          {user.email}
        </a>
      </div>

      <form
        action="/api/auth/[...all]/logout"
        method="POST"
        className="self-start"
      >
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Sign out
        </button>
      </form>
    </section>
  );
}
