import { createAuthClient } from "better-auth/client";

export function getSessionUser(sessionResult: unknown): { name?: string | null; email?: string | null } | null {
  if (typeof sessionResult === "object" && sessionResult !== null) {
    const obj = sessionResult as Record<string, unknown>;
    if (obj.user && typeof obj.user === "object") {
      return obj.user as { name?: string | null; email?: string | null };
    }
    if (obj.data && typeof obj.data === "object" && "user" in obj.data) {
      const user = (obj.data as Record<string, unknown>).user;
      if (user && typeof user === "object") {
        return user as { name?: string | null; email?: string | null };
      }
    }
  }
  return null;
}

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
});
