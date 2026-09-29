import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerAuthSession } from "@/lib/auth/session";

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const sessionRootPaths = ["/login", "/register", "/"];
  const isAuthRoot = sessionRootPaths.some((path) => url.pathname === path);

  // The customer portal is a separate authorization domain backed by its own
  // session cookie. Requiring a Better Auth session here would make the
  // customer entry point unreachable; its own route handlers authorize the
  // request instead.
  const customerPortalPaths = ["/portal", "/api/portal"];
  const isCustomerPortal = customerPortalPaths.some(
    (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
  );

  if (!isAuthRoot && !isCustomerPortal && !url.pathname.startsWith("/_")) {
    return getServerAuthSession()
      .then((session) => {
        if (!session?.user) {
          const loginUrl = new URL("/login", request.url);
          loginUrl.searchParams.set("next", url.pathname);
          return NextResponse.redirect(loginUrl);
        }
        return NextResponse.next();
      })
      .catch(() => {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("next", url.pathname);
        return NextResponse.redirect(loginUrl);
      });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon\\.ico).*)"],
};
