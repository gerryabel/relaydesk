import { NextResponse, type NextRequest } from 'next/server';
import { consumeRateLimit } from '@/lib/rate-limit/limiter';
import {
  CustomerMagicLinkInvalidError,
  CustomerRateLimitError,
  WorkspaceSlugNotFoundError,
} from '@/lib/customer-access/errors';
import { consumeCustomerMagicLink, resolveWorkspaceBySlug } from '@/lib/customer-access/server';
import { consumeCustomerMagicLinkSchema } from '@/lib/customer-access/schema';
import { buildMagicLinkVerifyRules, readClientIp } from '@/lib/customer-access/rate-limit';
import {
  CUSTOMER_SESSION_COOKIE_NAME,
  buildCustomerSessionCookieOptions,
} from '@/lib/customer-access/cookies';

/**
 * POST /api/portal/[workspaceSlug]/auth/magic-link/verify
 *
 * Consumes a single-use magic link and issues the customer session cookie.
 *
 * Every rejection — unknown token, malformed token, expired token, already
 * consumed token, token issued for another workspace — produces the identical
 * 400 response, so this endpoint cannot be used to test token existence.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await params;
    const body = await request.json().catch(() => null);

    const parsed = consumeCustomerMagicLinkSchema.safeParse({
      ...(typeof body === 'object' && body !== null ? body : {}),
      workspaceSlug,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const workspace = await resolveWorkspaceBySlug(parsed.data.workspaceSlug);

    const verdict = await consumeRateLimit(
      buildMagicLinkVerifyRules({
        workspaceId: workspace.id,
        ip: readClientIp(request.headers),
      }),
    );

    if (!verdict.allowed) {
      throw new CustomerRateLimitError();
    }

    const { sessionToken, session } = await consumeCustomerMagicLink(parsed.data);

    const response = NextResponse.json(
      {
        workspace: { name: session.workspaceName },
        customer: { name: session.email },
        expiresAt: session.expiresAt.toISOString(),
      },
      { status: 200 },
    );

    response.cookies.set({
      name: CUSTOMER_SESSION_COOKIE_NAME,
      value: sessionToken,
      ...buildCustomerSessionCookieOptions(),
    });

    return response;
  } catch (error) {
    if (error instanceof CustomerMagicLinkInvalidError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof CustomerRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }

    if (error instanceof WorkspaceSlugNotFoundError) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to verify sign-in link' }, { status: 500 });
  }
}
