import { NextResponse, type NextRequest } from 'next/server';
import {
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
  WorkspaceSlugNotFoundError,
} from '@/lib/customer-access/errors';
import { workspaceSlugSchema } from '@/lib/workspace/slug';
import { requireCustomerInWorkspace } from '@/lib/customer-access/session';
import { CUSTOMER_SESSION_COOKIE_NAME } from '@/lib/customer-access/cookies';

/**
 * GET /api/portal/[workspaceSlug]/auth/session
 *
 * Customer portal route protection. Answers with the minimal context a portal
 * page needs; exposes no internal user, membership or ticket identifiers.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string }> },
) {
  try {
    const { workspaceSlug } = await params;
    const slug = workspaceSlugSchema.parse(workspaceSlug);

    const { workspace, customer } = await requireCustomerInWorkspace(slug);

    return NextResponse.json({
      workspace: { name: workspace.name, slug: workspace.slug },
      customer: { name: customer.email },
      expiresAt: customer.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof CustomerUnauthenticatedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (error instanceof CustomerWorkspaceMismatchError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (error instanceof WorkspaceSlugNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Failed to resolve customer session' }, { status: 400 });
  }
}

export { CUSTOMER_SESSION_COOKIE_NAME };
