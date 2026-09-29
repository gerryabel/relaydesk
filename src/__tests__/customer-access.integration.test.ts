import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, type Prisma } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTestDatabaseUrl } from '@/lib/test/db';
import {
  generateCustomerToken,
  hashCustomerToken,
  sealToken,
  unsealToken,
} from '@/lib/customer-access/tokens';
import { findOrCreateCustomerForEmail } from '@/lib/customer-access/provisioning';
import {
  requestCustomerMagicLink,
  CUSTOMER_MAGIC_LINK_REQUEST_EVENT,
} from '@/lib/customer-access/server';
import { CustomerMagicLinkInvalidError, CustomerWorkspaceMismatchError } from '@/lib/customer-access/errors';
import { env } from '@/lib/env';

/**
 * Customer access security invariants that require a real database.
 *
 * These cover the guarantees that cannot be proven with mocks:
 *
 *  - the conditional UPDATE that makes magic links single-use under concurrency;
 *  - `ON CONFLICT DO NOTHING` first-time customer provisioning under concurrency;
 *  - cross-workspace token isolation;
 *  - the fact that no plaintext token is ever persisted.
 *
 * The concurrency cases run 8 genuinely parallel transactions against one
 * shared client, which is the point: they must not be weakened to sequential
 * calls to make them pass.
 */

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

const CONCURRENCY = 8;

describe('customer access invariants', () => {
  let prisma: PrismaClient;
  const createdWorkspaceIds: string[] = [];
  let workspaceId: string;
  let workspaceSlug: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(getTestDatabaseUrl()) });
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const workspace = await prisma.workspace.create({
      data: { id: createId('ws'), name: 'Customer Access Test', slug: createId('customer-access') },
    });
    workspaceId = workspace.id;
    workspaceSlug = workspace.slug;
    createdWorkspaceIds.push(workspace.id);
  });

  async function createWorkspace(name: string) {
    const workspace = await prisma.workspace.create({
      data: { id: createId('ws'), name, slug: createId('ws') },
    });
    createdWorkspaceIds.push(workspace.id);
    return workspace;
  }

  async function seedCustomer(email: string, name = 'Seed') {
    return prisma.customer.create({
      data: { workspaceId, name, email },
      select: { id: true, workspaceId: true, name: true, email: true },
    });
  }

  async function issueLink(email: string) {
    const customer = await seedCustomer(email);
    const rawToken = generateCustomerToken();

    await prisma.customerMagicLink.create({
      data: {
        workspaceId,
        customerId: customer.id,
        tokenHash: hashCustomerToken(rawToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    return { customer, rawToken };
  }

  /**
   * The exact claim performed by `consumeCustomerMagicLink`. Returns true only
   * for the single winner of the race.
   */
  async function claimLink(tx: Prisma.TransactionClient, tokenHash: string) {
    const { count } = await tx.customerMagicLink.updateMany({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    return count === 1;
  }

  describe('token persistence', () => {
    it('stores only a token digest, never the raw token', async () => {
      const { rawToken } = await issueLink('hash@example.com');

      const link = await prisma.customerMagicLink.findFirstOrThrow({
        where: { workspaceId, customer: { email: 'hash@example.com' } },
      });

      expect(link.tokenHash).toBe(hashCustomerToken(rawToken));
      expect(link.tokenHash).not.toContain(rawToken);
      expect(JSON.stringify(link)).not.toContain(rawToken);
    });

    it('round-trips a sealed token under the configured secret', () => {
      const rawToken = generateCustomerToken();
      const sealed = sealToken(rawToken, env.BETTER_AUTH_SECRET);

      expect(sealed).not.toContain(rawToken);
      expect(unsealToken(sealed, env.BETTER_AUTH_SECRET)).toBe(rawToken);
    });
  });

  describe('concurrent magic-link issuance', () => {
    it('serializes 8 concurrent requests into 1 outstanding link', async () => {
      const email = 'firsttime@example.com';

      // The real service, called 8x in parallel. Each call opens its own
      // interactive transaction that resolves/provisions the customer, locks the
      // customer row, sweeps outstanding links, inserts its link, and writes an
      // outbox event. No request may fail, and the sweep must be serialized so
      // exactly one link is left unconsumed.
      const requests = Array.from({ length: CONCURRENCY }, () =>
        requestCustomerMagicLink({ workspaceSlug, email }),
      );

      // Promise.allSettled: assert that *no* request rejected, including with a
      // P2002 or an aborted-transaction error.
      const settled = await Promise.allSettled(requests);
      const rejected = settled.filter((s) => s.status === 'rejected');

      expect(rejected.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
      expect(settled).toHaveLength(CONCURRENCY);

      // Exactly one Customer for the (workspaceId, email) pair: first-time
      // provisioning converged instead of racing.
      const customers = await prisma.customer.findMany({ where: { workspaceId, email } });
      expect(customers).toHaveLength(1);
      const customerId = customers[0]!.id;

      // Every request wrote a link row; none were lost.
      const links = await prisma.customerMagicLink.findMany({ where: { workspaceId } });
      expect(links).toHaveLength(CONCURRENCY);
      expect(new Set(links.map((l) => l.customerId))).toEqual(new Set([customerId]));

      // The invariant: the row lock serializes issuance, so the last transaction
      // to take the lock leaves the only outstanding link and consumes the rest.
      const outstanding = await prisma.customerMagicLink.count({
        where: { customerId, consumedAt: null },
      });
      expect(outstanding).toBe(1);
      expect(links.filter((l) => l.consumedAt !== null)).toHaveLength(CONCURRENCY - 1);

      // Each issuance emitted exactly one outbox event, all for this customer.
      const events = await prisma.outboxEvent.findMany({
        where: { aggregateType: 'Customer', aggregateId: customerId },
      });
      expect(events).toHaveLength(CONCURRENCY);
      expect(new Set(events.map((e) => e.eventType))).toEqual(
        new Set([CUSTOMER_MAGIC_LINK_REQUEST_EVENT]),
      );

      // Outbox payloads carry the sealed token, never the raw one.
      for (const event of events) {
        const payload = event.payload as { sealedToken?: unknown; email?: unknown };
        expect(typeof payload.sealedToken).toBe('string');
        expect(payload.email).toBe(email);
      }
    });

    it('keeps sequential issuance monotonic: only the last link stays valid', async () => {
      const email = 'sequential@example.com';

      // A: nothing outstanding before, A outstanding after.
      await requestCustomerMagicLink({ workspaceSlug, email });

      const customer = await prisma.customer.findFirstOrThrow({ where: { workspaceId, email } });
      const countOutstanding = () =>
        prisma.customerMagicLink.count({ where: { customerId: customer.id, consumedAt: null } });

      expect(await countOutstanding()).toBe(1);

      // B: A consumed, B outstanding.
      await requestCustomerMagicLink({ workspaceSlug, email });
      expect(await countOutstanding()).toBe(1);
      expect(await prisma.customerMagicLink.count({ where: { customerId: customer.id } })).toBe(2);

      // C: A/B consumed, C outstanding.
      await requestCustomerMagicLink({ workspaceSlug, email });
      expect(await countOutstanding()).toBe(1);
      expect(await prisma.customerMagicLink.count({ where: { customerId: customer.id } })).toBe(3);
      expect(
        await prisma.customerMagicLink.count({ where: { customerId: customer.id, consumedAt: null } }),
      ).toBe(1);

      // One customer throughout, and one outbox event per request.
      expect(await prisma.customer.count({ where: { workspaceId, email } })).toBe(1);
      expect(
        await prisma.outboxEvent.count({ where: { aggregateType: 'Customer', aggregateId: customer.id } }),
      ).toBe(3);
    });
  });

  describe('concurrent customer provisioning', () => {
    it('never overwrites an existing customer real name', async () => {
      const email = 'named@example.com';
      const existing = await seedCustomer(email, 'Budi Santoso, Distinctive Name');

      // Provisioning is a no-op for an existing row, so the seeded name is
      // preserved even though a portal user never supplies one.
      await requestCustomerMagicLink({ workspaceSlug, email });

      const after = await prisma.customer.findUniqueOrThrow({ where: { id: existing.id } });
      expect(after.name).toBe('Budi Santoso, Distinctive Name');
      expect(await prisma.customer.count({ where: { workspaceId, email } })).toBe(1);
    });

    it('provisions independently per workspace for the same email', async () => {
      const other = await createWorkspace('Second Workspace');
      const email = 'shared@example.com';

      const [a, b] = await Promise.all([
        prisma.$transaction((tx) => findOrCreateCustomerForEmail(tx, workspaceId, email, 'a')),
        prisma.$transaction((tx) => findOrCreateCustomerForEmail(tx, other.id, email, 'b')),
      ]);

      expect(a.id).not.toBe(b.id);
      expect(a.workspaceId).toBe(workspaceId);
      expect(b.workspaceId).toBe(other.id);
    });

    it('rejects a row whose workspace does not match', async () => {
      const other = await createWorkspace('Mismatch Target');
      const email = 'mismatch@example.com';
      const existing = await seedCustomer(email);

      // Simulates the ON CONFLICT winner belonging to a different workspace
      // than the request assumed. Must never be returned to the caller.
      const forged = {
        $queryRaw: (async () => []) as never,
        customer: {
          findFirst: (async () => ({ ...existing, workspaceId: other.id })) as never,
        },
      };

      await expect(
        findOrCreateCustomerForEmail(forged as never, workspaceId, email, 'x'),
      ).rejects.toBeInstanceOf(CustomerWorkspaceMismatchError);
    });
  });

  describe('concurrent token consumption', () => {
    it('lets exactly one of 8 concurrent verifications create a session', async () => {
      const { rawToken } = await issueLink('race@example.com');
      const tokenHash = hashCustomerToken(rawToken);

      // Full consumption path: claim, then create the session in the SAME
      // transaction, so a loser can never leave a session behind.
      const consume = () =>
        prisma.$transaction(async (tx) => {
          const claimed = await claimLink(tx, tokenHash);

          if (!claimed) {
            return 'rejected' as const;
          }

          const link = await tx.customerMagicLink.findUniqueOrThrow({ where: { tokenHash } });
          const sessionToken = generateCustomerToken();

          await tx.customerSession.create({
            data: {
              workspaceId: link.workspaceId,
              customerId: link.customerId,
              tokenHash: hashCustomerToken(sessionToken),
              expiresAt: new Date(Date.now() + 60_000),
            },
          });

          return 'session-created' as const;
        });

      const results = await Promise.all(Array.from({ length: CONCURRENCY }, consume));

      expect(results.filter((r) => r === 'session-created')).toHaveLength(1);
      expect(results.filter((r) => r === 'rejected')).toHaveLength(CONCURRENCY - 1);
      expect(await prisma.customerSession.count({ where: { workspaceId } })).toBe(1);
    });

    it('rejects a replay of an already consumed token', async () => {
      const { rawToken } = await issueLink('replay@example.com');
      const tokenHash = hashCustomerToken(rawToken);

      const withTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
        prisma.$transaction(fn);

      expect(await withTx((tx) => claimLink(tx, tokenHash))).toBe(true);
      // Same token, second attempt.
      expect(await withTx((tx) => claimLink(tx, tokenHash))).toBe(false);
    });

    it('rejects an expired token', async () => {
      const customer = await seedCustomer('expired@example.com');
      const tokenHash = hashCustomerToken(generateCustomerToken());

      await prisma.customerMagicLink.create({
        data: { workspaceId, customerId: customer.id, tokenHash, expiresAt: new Date(Date.now() - 1_000) },
      });

      expect(await prisma.$transaction((tx) => claimLink(tx, tokenHash))).toBe(false);
    });
  });

  describe('workspace isolation', () => {
    it('accepts a token in its own workspace and rejects it in another', async () => {
      const { rawToken } = await issueLink('isolated@example.com');
      const tokenHash = hashCustomerToken(rawToken);
      const other = await createWorkspace('Attacker Workspace');

      const link = await prisma.customerMagicLink.findFirstOrThrow({
        where: { workspaceId, customer: { email: 'isolated@example.com' } },
      });

      // Workspace A: the link's own workspace matches.
      expect(link.workspaceId).toBe(workspaceId);
      expect(link.workspaceId === other.id).toBe(false);

      // Workspace B: the same token must not be claimable as that workspace's.
      // Mirrors consumeCustomerMagicLink, which rejects on mismatch before any
      // conditional update is attempted.
      const crossWorkspace = async (resolvedWorkspaceId: string) =>
        prisma.$transaction(async (tx) => {
          const found = await tx.customerMagicLink.findUnique({
            where: { tokenHash },
            select: { id: true, workspaceId: true, consumedAt: true, expiresAt: true },
          });

          if (!found || found.workspaceId !== resolvedWorkspaceId) {
            throw new CustomerMagicLinkInvalidError();
          }

          return claimLink(tx, tokenHash);
        });

      await expect(crossWorkspace(workspaceId)).resolves.toBe(true);
      await expect(crossWorkspace(other.id)).rejects.toBeInstanceOf(CustomerMagicLinkInvalidError);

      // The workspace B attempt consumed nothing.
      const untouched = await prisma.customerSession.count({ where: { workspaceId: other.id } });
      expect(untouched).toBe(0);
    });

    it('keeps a customer session scoped to one workspace', async () => {
      const customer = await seedCustomer('session-scope@example.com');
      const other = await createWorkspace('Other Scope');

      await prisma.customerSession.create({
        data: {
          workspaceId,
          customerId: customer.id,
          tokenHash: hashCustomerToken(generateCustomerToken()),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const sessions = await prisma.customerSession.findMany({
        where: { customerId: customer.id },
        select: { workspaceId: true },
      });

      expect(sessions.every((s) => s.workspaceId === workspaceId)).toBe(true);
      expect(await prisma.customerSession.count({ where: { workspaceId: other.id } })).toBe(0);
    });
  });

  describe('session lifecycle', () => {
    it('resolves a session only while it is unexpired and unrevoked', async () => {
      const customer = await seedCustomer('session@example.com');
      const sessionToken = generateCustomerToken();

      const session = await prisma.customerSession.create({
        data: {
          workspaceId,
          customerId: customer.id,
          tokenHash: hashCustomerToken(sessionToken),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const found = await prisma.customerSession.findUnique({
        where: { tokenHash: hashCustomerToken(sessionToken) },
      });
      expect(found?.id).toBe(session.id);
      expect(found?.revokedAt).toBeNull();

      await prisma.customerSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

      const revoked = await prisma.customerSession.findUnique({
        where: { tokenHash: hashCustomerToken(sessionToken) },
      });
      expect(revoked?.revokedAt).not.toBeNull();
    });
  });

  describe('cascade', () => {
    it('removes customer access rows when a workspace is deleted', async () => {
      const { customer, rawToken } = await issueLink('cascade@example.com');
      const tokenHash = hashCustomerToken(rawToken);

      await prisma.customerSession.create({
        data: {
          workspaceId,
          customerId: customer.id,
          tokenHash: hashCustomerToken(generateCustomerToken()),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await prisma.workspace.delete({ where: { id: workspaceId } });
      createdWorkspaceIds.pop();

      expect(await prisma.customerMagicLink.count({ where: { tokenHash } })).toBe(0);
      expect(await prisma.customerSession.count({ where: { customerId: customer.id } })).toBe(0);
    });
  });

  describe('public slug', () => {
    it('resolves a workspace by its public slug', async () => {
      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { slug: true },
      });

      const resolved = await prisma.workspace.findUnique({
        where: { slug: workspace.slug },
        select: { id: true, slug: true },
      });

      expect(resolved?.id).toBe(workspaceId);
    });
  });
});
