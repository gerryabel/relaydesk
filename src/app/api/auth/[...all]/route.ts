import { auth } from "../../../lib/auth/auth";

export async function GET() {
  const session = await auth.api.getSession({ headers: {} });

  if (session?.user) {
    redirect("/app");
  }

  redirect("/login");
}
