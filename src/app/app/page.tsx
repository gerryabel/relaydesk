import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/lib/auth/session";
import { getDefaultWorkspace } from "@/lib/workspace/server";
import SignOutButton from "@/components/auth/sign-out-button";

export default async function AppPage() {
  const session = await getServerAuthSession();

  if (!session?.user) {
    redirect("/login");
  }

  const membership = await getDefaultWorkspace(session.user.id);

  if (!membership) {
    redirect("/app/setup");
  }

  const user = session.user;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl items-center px-4">
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

        <SignOutButton />
      </section>
    </main>
  );
}
