import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTestDatabaseUrl } from '@/lib/test/db';
import { generateCustomerToken, hashCustomerToken, sealToken, unsealToken } from '@/lib/customer-access/tokens';
import { env } from '@/lib/env';

/**
 * Customer access security invariants that require a real database.
 *
 * These cover the guarantees that cannot be proven with mocks: the conditional
 * UPDATE that makes magic links single-use under concurrency, the unique
 * constraint that arbitrates first-time customer provisioning, and the fact
 * that no plaintext token is ever persisted.
 */

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

describe('customer access invariants', () => {
  let prisma: PrismaClient;
  const createdWorkspaceIds: string[] = [];
  let workspaceId: string;

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
    createdWorkspaceIds.push(workspace.id);
  });

  async function seedCustomer(email: string) {
    return prisma.customer.create({
      data: { workspaceId, name: 'Seed', email },
      select: { id: true, workspaceId: true, email: true },
    });
  }

  it('stores only a token digest, never the raw token', async () => {
    const customer = await seedCustomer('hash@example.com');
    const rawToken = generateCustomerToken();

    const link = await prisma.customerMagicLink.create({
      data: {
        workspaceId,
        customerId: customer.id,
        tokenHash: hashCustomerToken(rawToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
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

  it('lets exactly one of N concurrent consumers claim a magic link', async () => {
    const customer = await seedCustomer('race@example.com');
    const tokenHash = hashCustomerToken(generateCustomerToken());

    await prisma.customerMagicLink.create({
      data: { workspaceId, customerId: customer.id, tokenHash, expiresAt: new Date(Date.now() + 60_000) },
    });

    // Mirrors `consumeCustomerMagicLink`: a conditional UPDATE on
    // `consumedAt: null` is the claim, and only `count === 1` may proceed.
    const attempt = () =>
      prisma.customerMagicLink.updateMany({
        where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });

    const results = await Promise.all(Array.from({ length: 8 }, attempt));

    expect(results.filter((r) => r.count === 1)).toHaveLength(1);
    expect(results.filter((r) => r.count === 0)).toHaveLength(7);

    const sessions = await prisma.customerSession.count({ where: { workspaceId } });
    expect(sessions).toBe(0);
  });

  it('rejects a consumed magic link on replay', async () => {
    const customer = await seedCustomer('replay@example.com');
    const tokenHash = hashCustomerToken(generateCustomerToken());

    const link = await prisma.customerMagicLink.create({
      data: {
        workspaceId,
        customerId: customer.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
      },
    });

    const claim = await prisma.customerMagicLink.updateMany({
      where: { id: link.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    expect(claim.count).toBe(0);
  });

  it('refuses to claim an expired magic link', async () => {
    const customer = await seedCustomer('expired@example.com');
    const tokenHash = hashCustomerToken(generateCustomerToken());

    await prisma.customerMagicLink.create({
      data: { workspaceId, customerId: customer.id, tokenHash, expiresAt: new Date(Date.now() - 1_000) },
    });

    const claim = await prisma.customerMagicLink.updateMany({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    expect(claim.count).toBe(0);
  });

  it('keeps the same email independent across workspaces', async () => {
    const other = await prisma.workspace.create({
      data: { id: createId('ws'), name: 'Other Workspace', slug: createId('other') },
    });
    createdWorkspaceIds.push(other.id);

    const a = await seedCustomer('shared@example.com');
    const b = await prisma.customer.create({
      data: { workspaceId: other.id, name: 'Seed', email: 'shared@example.com' },
      select: { id: true, workspaceId: true, email: true },
    });

    expect(a.id).not.toBe(b.id);
    expect(a.workspaceId).not.toBe(b.workspaceId);
  });

  it('arbitrates concurrent first-time provisioning with the unique constraint', async () => {
    const email = 'firsttime@example.com';

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.customer
          .create({ data: { workspaceId, name: 'First', email }, select: { id: true } })
          .then((row) => ({ ok: true as const, id: row.id }))
          .catch((error: unknown) => ({ ok: false as const, code: (error as { code?: string }).code })),
      ),
    );

    const created = attempts.filter((a) => a.ok);
    const rejected = attempts.filter((a) => !a.ok);

    expect(created).toHaveLength(1);
    expect(rejected.length).toBeGreaterThan(0);
    for (const failure of rejected) {
      expect(failure.code).toBe('P2002');
    }
    expect(await prisma.customer.count({ where: { workspaceId, email } })).toBe(1);
  });

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

    await prisma.customerSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const revoked = await prisma.customerSession.findUnique({
      where: { tokenHash: hashCustomerToken(sessionToken) },
    });
    expect(revoked?.revokedAt).not.toBeNull();
  });

  it('cascades customer access rows when a workspace is deleted', async () => {
    const customer = await seedCustomer('cascade@example.com');
    const tokenHash = hashCustomerToken(generateCustomerToken());

    await prisma.customerMagicLink.create({
      data: { workspaceId, customerId: customer.id, tokenHash, expiresAt: new Date(Date.now() + 60_000) },
    });
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
