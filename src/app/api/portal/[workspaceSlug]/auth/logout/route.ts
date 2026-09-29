import { NextResponse, type NextRequest } from 'next/server';
import { CUSTOMER_SESSION_COOKIE_NAME } from '@/lib/customer-access/cookies';
import { CUSTOMER_SESSION_COOKIE_PATH } from '@/lib/customer-access/config';
import { revokeCustomerSession } from '@/lib/customer-access/server';

/**
 * POST /api/portal/[workspaceSlug]/auth/logout
 *
 * Revokes the current customer session. Always answers 204, whether or not a
 * session was present, so logout cannot be used to probe session state.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  // The workspace slug is intentionally not used to authorize logout: the
  // session token identifies the row, and revoking it is always safe.
  void context;
  const rawToken = request.cookies.get(CUSTOMER_SESSION_COOKIE_NAME)?.value ?? null;

  try {
    await revokeCustomerSession(rawToken);
  } catch {
    // Revocation is best-effort from the caller's perspective: the cookie is
    // cleared regardless so the browser stops presenting the token.
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set({
    name: CUSTOMER_SESSION_COOKIE_NAME,
    value: '',
    path: CUSTOMER_SESSION_COOKIE_PATH,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
  });

  return response;
}
