import { NextResponse, type NextRequest } from 'next/server';
import { consumeRateLimit } from '@/lib/rate-limit/limiter';
import {
  CustomerRateLimitError,
  WorkspaceSlugNotFoundError,
} from '@/lib/customer-access/errors';
import { requestCustomerMagicLink, resolveWorkspaceBySlug } from '@/lib/customer-access/server';
import { requestCustomerMagicLinkSchema } from '@/lib/customer-access/schema';
import { buildMagicLinkRequestRules, readClientIp } from '@/lib/customer-access/rate-limit';

/**
 * POST /api/portal/[workspaceSlug]/auth/magic-link
 *
 * Issues a single-use customer sign-in link. Public endpoint: no session is
 * required and the response is identical whether the customer already existed
 * or was provisioned by this request, so it cannot be used to probe for
 * registered addresses.
 */

const GENERIC_RESPONSE = {
  message: 'If that address can receive a sign-in link, one has been sent.',
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await params;
    const body = await request.json().catch(() => null);

    const parsed = requestCustomerMagicLinkSchema.safeParse({
      ...(typeof body === 'object' && body !== null ? body : {}),
      workspaceSlug,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 },
      );
    }

    const workspace = await resolveWorkspaceBySlug(parsed.data.workspaceSlug);

    const verdict = await consumeRateLimit(
      buildMagicLinkRequestRules({
        workspaceId: workspace.id,
        email: parsed.data.email,
        ip: readClientIp(request.headers),
      }),
    );

    if (!verdict.allowed) {
      throw new CustomerRateLimitError();
    }

    await requestCustomerMagicLink(parsed.data);

    // 202 regardless of whether the address was known — enumeration resistant.
    return NextResponse.json(GENERIC_RESPONSE, { status: 202 });
  } catch (error) {
    if (error instanceof CustomerRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }

    if (error instanceof WorkspaceSlugNotFoundError) {
      // Same shape as the success path so an unknown slug is indistinguishable
      // from a known one.
      return NextResponse.json(GENERIC_RESPONSE, { status: 202 });
    }

    return NextResponse.json({ error: 'Failed to process sign-in request' }, { status: 500 });
  }
}
