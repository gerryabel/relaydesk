import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@/generated/prisma';
import { env } from '@/lib/env';
import {
  CustomerMagicLinkInvalidError,
  CustomerUnauthenticatedError,
  CustomerWorkspaceMismatchError,
  WorkspaceSlugNotFoundError,
} from './errors';
import {
  consumeCustomerMagicLinkSchema,
  requestCustomerMagicLinkSchema,
  type ConsumeCustomerMagicLinkInput,
  type RequestCustomerMagicLinkInput,
} from './schema';
import { generateCustomerToken, hashCustomerToken, sealToken } from './tokens';
import { CUSTOMER_MAGIC_LINK_TTL_MS, CUSTOMER_SESSION_TTL_MS } from './config';

/**
 * Customer portal access service (Phase 9 Task 1).
 *
 * Security invariants enforced here:
 *
 *  1. The workspace slug is a lookup key only. Every operation re-reads the
 *     workspace and the customer from the database and asserts
 *     `customer.workspaceId === workspace.id` before anything else happens.
 *  2. Magic links and sessions are persisted as SHA-256 digests only.
 *  3. Magic-link consumption is a single conditional UPDATE, so exactly one of
 *     N concurrent verifications can win.
 *  4. The raw token is never returned to the HTTP layer by `requestMagicLink`;
 *     it is sealed into the outbox payload and opened only by the email worker.
 */

export const CUSTOMER_MAGIC_LINK_REQUEST_EVENT = 'CUSTOMER_MAGIC_LINK_REQUESTED';

type TransactionClient = Prisma.TransactionClient;

export type PublicWorkspace = {
  id: string;
  name: string;
  slug: string;
};

export type CustomerSessionContext = {
  sessionId: string;
  customerId: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  email: string;
  expiresAt: Date;
};

/**
 * Resolves the public workspace slug to a persisted workspace.
 *
 * Throws {@link WorkspaceSlugNotFoundError} so the route layer can answer
 * without disclosing anything else.
 */
export async function resolveWorkspaceBySlug(slug: string): Promise<PublicWorkspace> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });

  if (!workspace) {
    throw new WorkspaceSlugNotFoundError();
  }

  return workspace;
}

/**
 * Resolves (or first-time provisions) the customer record for an email inside a
 * workspace.
 *
 * Task 1 is the only thing in the product that can create a `Customer`, and a
 * portal user has no agent-side onboarding step, so the row is created here on
 * first request. Two consequences, both deliberate:
 *
 *  - Unauthenticated callers can create customer rows. This is bounded by the
 *    per-workspace, per-workspace-email and per-IP limits in
 *    `./rate-limit`, and the HTTP response is identical for known and unknown
 *    addresses, so it cannot be used to enumerate customers.
 *  - `name` is seeded from the email local part as a display placeholder. A
 *    portal user never supplies a name, and Task 1 does not create tickets;
 *    Task 2 is where a real name is collected or refined.
 *
 * The `(workspaceId, email)` unique constraint is the race arbiter: concurrent
 * first-time requests both attempt the INSERT and the loser re-reads the
 * winner's row.
 */
async function resolveCustomerForEmail(
  tx: TransactionClient,
  workspaceId: string,
  email: string,
): Promise<{ id: string; workspaceId: string; email: string | null }> {
  const existing = await tx.customer.findFirst({
    where: { workspaceId, email },
    select: { id: true, workspaceId: true, email: true },
  });

  if (existing) {
    // Defence in depth: never trust the lookup filter alone.
    if (existing.workspaceId !== workspaceId) {
      throw new CustomerWorkspaceMismatchError();
    }

    return existing;
  }

  try {
    return await tx.customer.create({
      data: {
        workspaceId,
        name: emailLocalPart(email),
        email,
      },
      select: { id: true, workspaceId: true, email: true },
    });
  } catch (error) {
    if (!isUniqueCustomerEmailError(error)) {
      throw error;
    }

    // A concurrent request won the insert. Re-read outside the failed
    // statement's error path so this transaction still returns a usable row.
    const winner = await tx.customer.findFirst({
      where: { workspaceId, email },
      select: { id: true, workspaceId: true, email: true },
    });

    if (!winner || winner.workspaceId !== workspaceId) {
      throw new CustomerWorkspaceMismatchError();
    }

    return winner;
  }
}

function isUniqueCustomerEmailError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

/** Seeds a display name from the address when the portal user supplies none. */
function emailLocalPart(email: string): string {
  const local = email.slice(0, email.indexOf('@'));

  return local.length > 0 ? local : email;
}

/**
 * Issues a single-use magic link for a customer of the resolved workspace.
 *
 * The response is intentionally identical whether the customer already existed
 * or was just provisioned, so the endpoint cannot be used to probe for
 * registered addresses.
 *
 * Returns only non-sensitive data. The raw token is written to the outbox
 * sealed, and is opened exclusively by the async email worker.
 */
export async function requestCustomerMagicLink(
  rawInput: RequestCustomerMagicLinkInput,
): Promise<{ workspace: PublicWorkspace; email: string }> {
  const parsed = requestCustomerMagicLinkSchema.parse(rawInput);
  const workspace = await resolveWorkspaceBySlug(parsed.workspaceSlug);

  const rawToken = generateCustomerToken();
  const tokenHash = hashCustomerToken(rawToken);
  const expiresAt = new Date(Date.now() + CUSTOMER_MAGIC_LINK_TTL_MS);

  await prisma.$transaction(async (tx) => {
    const customer = await resolveCustomerForEmail(tx, workspace.id, parsed.email);

    // Bound growth: only the newest outstanding link per customer stays valid.
    await tx.customerMagicLink.updateMany({
      where: {
        customerId: customer.id,
        workspaceId: workspace.id,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });

    await tx.customerMagicLink.create({
      data: {
        workspaceId: workspace.id,
        customerId: customer.id,
        tokenHash,
        expiresAt,
      },
    });

    await tx.outboxEvent.create({
      data: {
        eventType: CUSTOMER_MAGIC_LINK_REQUEST_EVENT,
        aggregateType: 'Customer',
        aggregateId: customer.id,
        payload: {
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
          workspaceName: workspace.name,
          customerId: customer.id,
          email: parsed.email,
          // Sealed, not plaintext: the outbox row is persisted in the database.
          sealedToken: sealToken(rawToken, env.BETTER_AUTH_SECRET),
          expiresAt: expiresAt.toISOString(),
        },
      },
    });
  });

  return { workspace, email: parsed.email };
}

export type ConsumeMagicLinkResult = {
  /** Raw session token. Returned once, to be delivered as an HttpOnly cookie. */
  sessionToken: string;
  session: CustomerSessionContext;
};

/**
 * Consumes a magic link and creates the customer session.
 *
 * Atomicity: the token row is claimed with a conditional `updateMany` on
 * `consumedAt: null`. Under READ COMMITTED, two concurrent verifications
 * serialize on the row lock and exactly one observes `count === 1`; the other
 * observes `count === 0` and fails. Session creation happens in the same
 * transaction, so a losing request can never leave a session behind.
 */
export async function consumeCustomerMagicLink(
  rawInput: ConsumeCustomerMagicLinkInput,
): Promise<ConsumeMagicLinkResult> {
  const parsed = consumeCustomerMagicLinkSchema.parse(rawInput);
  const workspace = await resolveWorkspaceBySlug(parsed.workspaceSlug);
  const tokenHash = hashCustomerToken(parsed.token);

  const sessionToken = generateCustomerToken();

  const result = await prisma.$transaction(async (tx) => {
    const magicLink = await tx.customerMagicLink.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        workspaceId: true,
        customerId: true,
        expiresAt: true,
        consumedAt: true,
      },
    });

    // Every failure below is reported identically so a caller cannot use the
    // response to distinguish "unknown token" from "wrong workspace".
    if (!magicLink || magicLink.workspaceId !== workspace.id) {
      throw new CustomerMagicLinkInvalidError();
    }

    if (magicLink.expiresAt.getTime() <= Date.now()) {
      throw new CustomerMagicLinkInvalidError();
    }

    const claimed = await tx.customerMagicLink.updateMany({
      where: { id: magicLink.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    if (claimed.count !== 1) {
      throw new CustomerMagicLinkInvalidError();
    }

    const customer = await tx.customer.findFirst({
      where: { id: magicLink.customerId, workspaceId: workspace.id },
      select: { id: true, workspaceId: true, email: true },
    });

    if (!customer || customer.workspaceId !== workspace.id) {
      throw new CustomerMagicLinkInvalidError();
    }

    const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_MS);

    const session = await tx.customerSession.create({
      data: {
        workspaceId: workspace.id,
        customerId: customer.id,
        tokenHash: hashCustomerToken(sessionToken),
        expiresAt,
      },
      select: {
        id: true,
        customerId: true,
        workspaceId: true,
        expiresAt: true,
      },
    });

    return {
      sessionToken,
      session: {
        sessionId: session.id,
        customerId: session.customerId,
        workspaceId: session.workspaceId,
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
        email: customer.email ?? '',
        expiresAt: session.expiresAt,
      } satisfies CustomerSessionContext,
    };
  });

  return result;
}

/**
 * Resolves a raw session token into a customer context.
 *
 * Returns `null` for unknown, expired or revoked sessions. The customer and
 * workspace rows are re-read on every call so a deleted customer or workspace
 * immediately invalidates the session.
 */
export async function resolveCustomerSession(
  rawToken: string | null | undefined,
): Promise<CustomerSessionContext | null> {
  if (!rawToken) {
    return null;
  }

  const session = await prisma.customerSession.findUnique({
    where: { tokenHash: hashCustomerToken(rawToken) },
    select: {
      id: true,
      customerId: true,
      workspaceId: true,
      expiresAt: true,
      revokedAt: true,
      customer: { select: { id: true, workspaceId: true, email: true } },
      workspace: { select: { id: true, name: true, slug: true } },
    },
  });

  if (!session || session.revokedAt !== null) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  if (session.customer.workspaceId !== session.workspaceId) {
    return null;
  }

  if (session.workspace.id !== session.workspaceId) {
    return null;
  }

  return {
    sessionId: session.id,
    customerId: session.customerId,
    workspaceId: session.workspaceId,
    workspaceSlug: session.workspace.slug,
    workspaceName: session.workspace.name,
    email: session.customer.email ?? '',
    expiresAt: session.expiresAt,
  };
}

/** Revokes a session. Safe to call repeatedly; a no-op for unknown tokens. */
export async function revokeCustomerSession(rawToken: string | null | undefined): Promise<boolean> {
  if (!rawToken) {
    return false;
  }

  const { count } = await prisma.customerSession.updateMany({
    where: { tokenHash: hashCustomerToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return count > 0;
}

/** Best-effort activity marker; failures must never fail an authorized request. */
export async function touchCustomerSession(sessionId: string): Promise<void> {
  try {
    await prisma.customerSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastUsedAt: new Date() },
    });
  } catch {
    // Intentionally ignored.
  }
}

/**
 * Server-side authorization primitive.
 *
 * Throws {@link CustomerWorkspaceMismatchError} whenever the authenticated
 * customer is not a member of the resolved workspace, which is the single
 * invariant every customer route must hold.
 */
export function assertCustomerInWorkspace(
  context: CustomerSessionContext,
  workspace: PublicWorkspace,
): void {
  if (context.workspaceId !== workspace.id) {
    throw new CustomerWorkspaceMismatchError();
  }
}

export function requireCustomerSession(
  context: CustomerSessionContext | null,
): CustomerSessionContext {
  if (!context) {
    throw new CustomerUnauthenticatedError();
  }

  return context;
}
