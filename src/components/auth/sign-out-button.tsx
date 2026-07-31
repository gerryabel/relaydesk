"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/auth-client";

export default function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.replace("/login");
  }

  return (
    <button
      onClick={handleSignOut}
      className="self-start rounded-md border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-700 dark:hover:bg-neutral-800"
    >
      Sign out
    </button>
  );
}
