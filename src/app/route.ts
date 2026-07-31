import { auth } from "@/src/lib/auth/auth";
import { redirect } from "next/navigation";

export async function GET() {
  const session = await auth.api.getSession({ headers: {} });

  if (session?.user) {
    redirect("/app");
  }

  redirect("/login");
}
