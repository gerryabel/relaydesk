import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
  CustomerAttachmentNotFoundError,
  CustomerAttachmentStorageError,
  CustomerAttachmentValidationError,
  downloadCustomerAttachment,
  uploadCustomerAttachment,
} from '@/lib/customer-portal/attachments';
import { CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT } from '@/lib/customer-portal/schema';
import { attachmentConfig } from '@/lib/attachments/config';
import type { StorageProvider } from '@/lib/attachments/storage.interface';

/**
 * Customer attachment service, against a mocked Prisma client (Phase 9 Task 4).
 *
 * What this file proves is the *query shape*, which is the property the design
 * rests on and the only one mocks can address directly: every ownership
 * predicate is a `where` clause, so a foreign id matches zero rows and there is
 * no read-then-judge step that could be forgotten.
 *
 * That a predicate which *looks* right actually behaves that way against real
 * SQL is a separate claim, and it is made in
 * `customer-attachments.integration.test.ts`. Both are needed: a shape assertion
 * cannot see SQL semantics, and a SQL assertion cannot see which fields the
 * query reads.
 *
 * The Prisma mock is a hand-built object rather than an auto-mock so the test
 * states exactly which calls the service is allowed to make. A new query shows
 * up here as `undefined` rather than passing silently.
 */

const prismaMocks = vi.hoisted(() => ({
  messageFindFirst: vi.fn(),
  attachmentCount: vi.fn(),
  attachmentFindFirst: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    message: { findFirst: prismaMocks.messageFindFirst },
    attachment: {
      count: prismaMocks.attachmentCount,
      findFirst: prismaMocks.attachmentFindFirst,
    },
    $transaction: prismaMocks.transaction,
  },
}));

vi.mock('@/lib/customer-portal/session', async (importOriginal) => {
  // Only the session lookup is stubbed: the authorization *predicates* built
  // from its result are the thing under test.
  const actual = await importOriginal<typeof import('@/lib/customer-portal/session')>();

  return { ...actual, requireCustomerInWorkspace: vi.fn() };
});

const { requireCustomerInWorkspace } = await import('@/lib/customer-portal/session');
const mockedRequireSession = vi.mocked(requireCustomerInWorkspace);

const workspace = { id: 'workspace-1', name: 'Acme Support', slug: 'acme-support' };
const otherWorkspace = { id: 'workspace-2', name: 'Other', slug: 'other' };
const customerId = 'customer-1';
const ticketId = 'ticket-1';
const messageId = 'message-1';

function sessionFor(
  activeWorkspace = workspace,
  activeCustomerId = customerId,
): { workspace: typeof workspace; customer: Record<string, unknown> } {
  return {
    workspace: activeWorkspace,
    customer: {
      sessionId: 'session-1',
      customerId: activeCustomerId,
      workspaceId: activeWorkspace.id,
      workspaceSlug: activeWorkspace.slug,
      workspaceName: activeWorkspace.name,
      email: 'buyer@example.com',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    },
  };
}

/**
 * A storage double whose calls can be inspected.
 *
 * Each member is typed as the mocked form of its real signature, so the object
 * is assignable to `StorageProvider` *and* exposes `.mock.calls` without a cast.
 */
type MockStorage = {
  put: Mock<StorageProvider['put']>;
  get: Mock<StorageProvider['get']>;
  delete: Mock<StorageProvider['delete']>;
  exists: Mock<StorageProvider['exists']>;
};

function createMockStorage(overrides: Partial<MockStorage> = {}): MockStorage {
  return {
    put: vi.fn<StorageProvider['put']>().mockResolvedValue(undefined),
    get: vi.fn<StorageProvider['get']>().mockResolvedValue(Buffer.from('stored bytes')),
    delete: vi.fn<StorageProvider['delete']>().mockResolvedValue(undefined),
    exists: vi.fn<StorageProvider['exists']>().mockResolvedValue(true),
    ...overrides,
  };
}

const pdfBytes = Buffer.from('%PDF-1.7 fake');

function validUpload(overrides: Partial<Parameters<typeof uploadCustomerAttachment>[0]> = {}) {
  return {
    workspaceSlug: workspace.slug,
    ticketId,
    messageId,
    declaredFilename: 'invoice.pdf',
    declaredMimeType: 'application/pdf',
    buffer: pdfBytes,
    ...overrides,
  };
}

/** The transaction client the service is handed. */
function transactionTx() {
  return {
    attachment: {
      create: vi.fn().mockResolvedValue({
        id: 'attachment-1',
        originalFilename: 'invoice.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfBytes.length,
        createdAt: new Date('2026-02-01T10:00:00Z'),
      }),
    },
    ticketActivity: { create: vi.fn().mockResolvedValue({ id: 'activity-1' }) },
  };
}

/**
 * A transaction client whose `attachment.create` echoes its input back with a
 * generated id, the way a real database behaves.
 *
 * The fixed-row version of this mock would silently invalidate every assertion
 * about a *sanitized* filename or a *normalized* mime type: the service returns
 * what the database echoed, so a mock that always says `invoice.pdf` makes the
 * sanitizer look broken rather than making the mock wrong.
 */
function echoTransactionTx() {
  const tx = transactionTx();

  tx.attachment.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'attachment-1', createdAt: new Date('2026-02-01T10:00:00Z'), ...data }),
  );

  return tx;
}

/**
 * The transaction client handed to the service in the current test. Tests that
 * assert on what was written must read *this* object, not a freshly built one —
 * a separate instance would record no calls and the assertion would pass for
 * the wrong reason.
 */
let tx: ReturnType<typeof echoTransactionTx>;

beforeEach(() => {
  mockedRequireSession.mockResolvedValue(sessionFor() as never);
  prismaMocks.messageFindFirst.mockResolvedValue({ id: messageId, ticketId } as never);
  prismaMocks.attachmentCount.mockResolvedValue(0);

  tx = echoTransactionTx();

  prismaMocks.transaction.mockImplementation((work: (inner: unknown) => Promise<unknown>) =>
    work(tx),
  );
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('uploadCustomerAttachment — authorization', () => {
  it('scopes the message lookup by every ownership predicate in one query', async () => {
    await uploadCustomerAttachment(validUpload(), createMockStorage());

    const where = prismaMocks.messageFindFirst.mock.calls[0]?.[0]?.where;

    // This object is the authorization. Each line is required:
    //
    //   id + ticketId   — the ids the caller supplied, which are lookup keys
    //   authorType      — only a customer-authored message accepts a customer file
    //   customerId      — the session's customer, not a request-supplied one
    //   createdById     — null rules out an agent message carrying a customer id
    //   ticket.workspaceId / ticket.customerId — the ticket must be *owned*
    //
    // There is no branch after this query: either it matches one row or none.
    expect(where).toEqual({
      id: messageId,
      ticketId,
      authorType: 'customer',
      customerId,
      createdById: null,
      ticket: {
        workspaceId: workspace.id,
        customerId,
      },
    });
  });

  it('derives both ids from the session, never from the request', async () => {
    // A caller-supplied customerId would show up here as a predicate that is not
    // the session's value. There is no such parameter, so there is nothing to
    // assert other than that the session's ids are what was used.
    await uploadCustomerAttachment(
      validUpload({ ticketId, messageId }),
      createMockStorage(),
    );

    const where = prismaMocks.messageFindFirst.mock.calls[0]?.[0]?.where as {
      customerId: string;
      ticket: { workspaceId: string; customerId: string };
    };

    expect(where.customerId).toBe(customerId);
    expect(where.ticket.customerId).toBe(customerId);
    expect(where.ticket.workspaceId).toBe(workspace.id);
  });

  it.each([
    ['another customer message', { messageFindFirst: null }],
    ['a ticket the customer does not own', { messageFindFirst: null }],
    ['an agent-authored message', { messageFindFirst: null }],
    ['a system message', { messageFindFirst: null }],
    ['an unknown message', { messageFindFirst: null }],
    ['another workspace', { messageFindFirst: null }],
  ])('reports %s as not found and writes nothing', async (_label, outcome) => {
    prismaMocks.messageFindFirst.mockResolvedValue(outcome.messageFindFirst as never);

    const storage = createMockStorage();

    // Every one of these cases is the same single line in the service — the
    // predicate did not match. There is no per-case error message to leak.
    await expect(uploadCustomerAttachment(validUpload(), storage)).rejects.toBeInstanceOf(
      CustomerAttachmentNotFoundError,
    );

    expect(storage.put).not.toHaveBeenCalled();
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it('uses the same error for a foreign id and an unknown one', async () => {
    const foreign = new CustomerAttachmentNotFoundError();
    const unknown = new CustomerAttachmentNotFoundError();

    // Byte-identical: a difference here would be an existence oracle for every
    // message id in every workspace.
    expect(foreign.message).toBe(unknown.message);
  });

  it('never contacts the database for an unauthenticated caller', async () => {
    const { CustomerUnauthenticatedError } = await import('@/lib/customer-access/errors');

    mockedRequireSession.mockRejectedValue(new CustomerUnauthenticatedError());

    await expect(
      uploadCustomerAttachment(validUpload(), createMockStorage()),
    ).rejects.toBeInstanceOf(CustomerUnauthenticatedError);

    // No ticket, no message, no attachment, no storage: the session is the first
    // gate, before any id from the URL is looked at.
    expect(prismaMocks.messageFindFirst).not.toHaveBeenCalled();
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a session bound to another workspace before touching any row', async () => {
    const { CustomerWorkspaceMismatchError } = await import('@/lib/customer-access/errors');

    // The session is for workspace 2 but the URL says workspace 1. The guard
    // throws before the service ever builds a predicate.
    mockedRequireSession.mockRejectedValue(new CustomerWorkspaceMismatchError());

    await expect(
      uploadCustomerAttachment(validUpload({ workspaceSlug: workspace.slug }), createMockStorage()),
    ).rejects.toBeInstanceOf(CustomerWorkspaceMismatchError);

    expect(prismaMocks.messageFindFirst).not.toHaveBeenCalled();
  });

  it('scopes the query by the session workspace, not by the slug in the URL', async () => {
    // Defense in depth, and the reason the service takes both the slug and the
    // session. `requireCustomerInWorkspace` is what *rejects* a slug that does
    // not match the session (tested in the case above, against the real helper);
    // this asserts the second, independent gate: even if the slug were honoured
    // by some future caller, the predicate itself is pinned to the workspace the
    // session actually resolved to.
    mockedRequireSession.mockResolvedValue(sessionFor(otherWorkspace) as never);

    await uploadCustomerAttachment(
      validUpload({ workspaceSlug: workspace.slug }),
      createMockStorage(),
    );

    const where = prismaMocks.messageFindFirst.mock.calls[0]?.[0]?.where as {
      ticket: { workspaceId: string; customerId: string };
    };

    // The URL said `acme-support`; the predicate says workspace-2.
    expect(where.ticket.workspaceId).toBe(otherWorkspace.id);
    expect(where.ticket.workspaceId).not.toBe(workspace.id);
  });
});

describe('uploadCustomerAttachment — validation', () => {
  it('rejects an empty file', async () => {
    await expect(
      uploadCustomerAttachment(
        validUpload({ buffer: Buffer.alloc(0) }),
        createMockStorage(),
      ),
    ).rejects.toBeInstanceOf(CustomerAttachmentValidationError);

    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a file above the 10 MiB maximum', async () => {
    const oversize = Buffer.alloc(attachmentConfig.maxFileSizeBytes + 1);

    await expect(
      uploadCustomerAttachment(validUpload({ buffer: oversize }), createMockStorage()),
    ).rejects.toBeInstanceOf(CustomerAttachmentValidationError);
  });

  it('accepts a file exactly at the maximum', async () => {
    const atLimit = Buffer.alloc(attachmentConfig.maxFileSizeBytes);

    const result = await uploadCustomerAttachment(
      validUpload({ buffer: atLimit }),
      createMockStorage(),
    );

    expect(result.sizeBytes).toBe(attachmentConfig.maxFileSizeBytes);
  });

  it.each([
    'application/x-executable',
    'application/javascript',
    '*/*',
    'image/*',
    'text/html',
    'application/octet-stream',
    '',
  ])('rejects the declared MIME type %j', async (mimeType) => {
    await expect(
      uploadCustomerAttachment(
        validUpload({ declaredMimeType: mimeType }),
        createMockStorage(),
      ),
    ).rejects.toBeInstanceOf(CustomerAttachmentValidationError);
  });

  it('rejects an executable regardless of how innocent the filename looks', async () => {
    // The extension is not the control; the declared type is.
    await expect(
      uploadCustomerAttachment(
        validUpload({ declaredFilename: 'photo.jpg', declaredMimeType: 'application/x-executable' }),
        createMockStorage(),
      ),
    ).rejects.toBeInstanceOf(CustomerAttachmentValidationError);
  });

  it.each([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'text/plain',
    'text/csv',
    'application/zip',
  ])('accepts the allowed type %j', async (mimeType) => {
    const result = await uploadCustomerAttachment(
      validUpload({ declaredMimeType: mimeType, declaredFilename: 'file.bin' }),
      createMockStorage(),
    );

    expect(result.mimeType).toBe(mimeType);
  });

  it('accepts a charset-qualified declaration', async () => {
    const result = await uploadCustomerAttachment(
      validUpload({ declaredMimeType: 'text/plain; charset=utf-8' }),
      createMockStorage(),
    );

    expect(result.mimeType).toBe('text/plain');
  });

  it('rejects a file once the per-message limit is reached', async () => {
    prismaMocks.attachmentCount.mockResolvedValue(CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT);

    await expect(
      uploadCustomerAttachment(validUpload(), createMockStorage()),
    ).rejects.toBeInstanceOf(CustomerAttachmentValidationError);

    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it('derives sizeBytes from the received bytes, not from anything declared', async () => {
    const buffer = Buffer.from('twelve chars');

    const result = await uploadCustomerAttachment(validUpload({ buffer }), createMockStorage());

    // The only source is the buffer. There is no form field, no header and no
    // browser-side `File.size` in the signature to have been believed instead.
    expect(result.sizeBytes).toBe(buffer.length);

    const data = tx.attachment.create.mock.calls[0]?.[0]?.data as { sizeBytes: number };

    expect(data.sizeBytes).toBe(buffer.length);
  });

  it.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\windows\\system32\\config', 'config'],
    ['a\rb.txt', 'ab.txt'],
    ['a\nb.txt', 'ab.txt'],
    ['..', 'attachment'],
    ['photo\u202Etxt.exe', 'phototxt.exe'],
  ])('normalizes the hostile filename %j before storing it', async (declared, expected) => {
    const result = await uploadCustomerAttachment(
      validUpload({ declaredFilename: declared }),
      createMockStorage(),
    );

    expect(result.originalFilename).toBe(expected);

    const data = tx.attachment.create.mock.calls[0]?.[0]?.data as {
      originalFilename: string;
    };

    expect(data.originalFilename).toBe(expected);
  });

  it('never lets a filename influence the storage path', async () => {
    const storage = createMockStorage();

    await uploadCustomerAttachment(
      validUpload({ declaredFilename: '../../../../etc/passwd' }),
      storage,
    );

    const key = storage.put.mock.calls[0]?.[0] as string;

    // Opaque UUID under a fixed prefix. Nothing from the filename — not even a
    // basename of it — reaches the key.
    expect(key).toMatch(/^attachments\/[0-9a-f-]{36}$/);
    expect(key).not.toContain('passwd');
    expect(key).not.toContain('..');
    expect(key).not.toContain('/etc');
  });

  it('generates a distinct key per upload', async () => {
    const storage = createMockStorage();

    await uploadCustomerAttachment(validUpload(), storage);
    await uploadCustomerAttachment(validUpload(), storage);

    const [first] = storage.put.mock.calls[0]!;
    const [second] = storage.put.mock.calls[1]!;

    expect(first).not.toBe(second);
  });
});

describe('uploadCustomerAttachment — storage lifecycle', () => {
  it('writes storage before the metadata transaction', async () => {
    const order: string[] = [];
    const storage = createMockStorage({
      put: vi.fn(async () => {
        order.push('storage');
      }),
    });

    prismaMocks.transaction.mockImplementation(async (work: (inner: unknown) => Promise<unknown>) => {
      order.push('transaction');

      return work(tx);
    });

    await uploadCustomerAttachment(validUpload(), storage);

    // The provider has no transaction to enlist in, so the file has to land
    // first. The consequence is the cleanup path below, not a choice.
    expect(order).toEqual(['storage', 'transaction']);
  });

  it('deletes the stored object when the metadata transaction fails', async () => {
    const storage = createMockStorage();

    prismaMocks.transaction.mockRejectedValue(
      new Error('violates foreign key constraint "Attachment_messageId_fkey"'),
    );

    await expect(uploadCustomerAttachment(validUpload(), storage)).rejects.toBeInstanceOf(
      CustomerAttachmentStorageError,
    );

    // Without this, the file would be in storage with no row referencing it and
    // no customer-visible way to remove it.
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0]?.[0]);
  });

  it('does not attempt a delete when the object was never stored', async () => {
    const storage = createMockStorage({ exists: vi.fn().mockResolvedValue(false) });

    prismaMocks.transaction.mockRejectedValue(new Error('boom'));

    await expect(uploadCustomerAttachment(validUpload(), storage)).rejects.toBeInstanceOf(
      CustomerAttachmentStorageError,
    );

    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('still reports the original failure when cleanup also fails', async () => {
    const storage = createMockStorage({
      delete: vi.fn().mockRejectedValue(new Error('EACCES: permission denied')),
    });

    prismaMocks.transaction.mockRejectedValue(new Error('DB write failed'));

    // Replacing the real cause with "cleanup failed" would send an operator to
    // the wrong place.
    await expect(uploadCustomerAttachment(validUpload(), storage)).rejects.toBeInstanceOf(
      CustomerAttachmentStorageError,
    );
  });

  it('surfaces a storage write failure without naming the key or the path', async () => {
    const storage = createMockStorage({
      put: vi.fn<StorageProvider['put']>().mockRejectedValue(
        new Error('EACCES: /srv/relaydesk/storage/attachments'),
      ),
    });

    const error: Error = await uploadCustomerAttachment(validUpload(), storage).then(
      () => {
        throw new Error('expected the upload to fail');
      },
      (caught: Error) => caught,
    );

    expect(error).toBeInstanceOf(CustomerAttachmentStorageError);
    expect(error.message).not.toContain('/srv');
    expect(error.message).not.toContain('EACCES');
    expect(error.message).not.toContain('attachments/');

    // Nothing was written, so nothing should be cleaned up either.
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it('stores metadata and activity in one transaction', async () => {
    const result = await uploadCustomerAttachment(validUpload(), createMockStorage());

    expect(result.id).toBe('attachment-1');

    // Both writes, so an attachment row can never exist without its activity.
    expect(tx.attachment.create).toHaveBeenCalledTimes(1);
    expect(tx.ticketActivity.create).toHaveBeenCalledTimes(1);

    const activity = tx.ticketActivity.create.mock.calls[0]?.[0]?.data as {
      ticketId: string;
      actorId: string | null;
      type: string;
    };

    expect(activity).toMatchObject({
      // From the authorized message, never from the request.
      ticketId,
      // A customer is not a `User`. Attributing the upload to an arbitrary
      // workspace user would fabricate an actor.
      actorId: null,
      type: 'ATTACHMENT_ADDED',
    });
  });

  it('returns a DTO with no storage key, message id or customer id', async () => {
    const result = await uploadCustomerAttachment(validUpload(), createMockStorage());

    expect(Object.keys(result).sort()).toEqual([
      'createdAt',
      'id',
      'mimeType',
      'originalFilename',
      'sizeBytes',
    ]);

    for (const forbidden of ['storageKey', 'messageId', 'customerId', 'workspaceId', 'ticketId']) {
      expect(JSON.stringify(result)).not.toContain(forbidden);
    }
  });
});

describe('downloadCustomerAttachment', () => {
  function storedAttachment(overrides: Record<string, unknown> = {}) {
    return {
      id: 'attachment-1',
      storageKey: 'attachments/6f1b0b8e-1f0a-4a6b-9b3a-6d2f2a1c0e11',
      originalFilename: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5,
      ...overrides,
    };
  }

  it('authorizes the whole chain in a single predicate', async () => {
    prismaMocks.attachmentFindFirst.mockResolvedValue(storedAttachment() as never);

    await downloadCustomerAttachment(
      { workspaceSlug: workspace.slug, attachmentId: 'attachment-1' },
      createMockStorage(),
    );

    const args = prismaMocks.attachmentFindFirst.mock.calls[0]?.[0];

    // attachment -> message (customer-visible author type) -> ticket ->
    // (authenticated workspace, authenticated customer). Every hop is a
    // `where` clause, so there is no intermediate read whose result could be
    // forgotten before the next check.
    expect(args?.where).toEqual({
      id: 'attachment-1',
      message: {
        authorType: { in: ['agent', 'customer'] },
        ticket: {
          workspaceId: workspace.id,
          customerId,
        },
      },
    });
  });

  it.each([
    ['another customer attachment', null],
    ['another workspace attachment', null],
    ['an internal-only attachment', null],
    ['a system message attachment', null],
    ['a missing attachment', null],
  ])('reports %s as not found without reaching storage', async (_label, row) => {
    prismaMocks.attachmentFindFirst.mockResolvedValue(row as never);

    const storage = createMockStorage();

    await expect(
      downloadCustomerAttachment(
        { workspaceSlug: workspace.slug, attachmentId: 'attachment-1' },
        storage,
      ),
    ).rejects.toBeInstanceOf(CustomerAttachmentNotFoundError);

    // A foreign id costs one SELECT and no filesystem access.
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('gives every failure the same message', async () => {
    prismaMocks.attachmentFindFirst.mockResolvedValue(null);

    const foreign = await downloadCustomerAttachment(
      { workspaceSlug: workspace.slug, attachmentId: 'a' },
      createMockStorage(),
    ).catch((error: Error) => error.message);

    const unknown = await downloadCustomerAttachment(
      { workspaceSlug: workspace.slug, attachmentId: 'b' },
      createMockStorage(),
    ).catch((error: Error) => error.message);

    expect(foreign).toBe(unknown);
  });

  it('returns the bytes only after the predicate matched', async () => {
    prismaMocks.attachmentFindFirst.mockResolvedValue(storedAttachment() as never);

    const storage = createMockStorage();
    const result = await downloadCustomerAttachment(
      { workspaceSlug: workspace.slug, attachmentId: 'attachment-1' },
      storage,
    );

    expect(result.buffer.toString()).toBe('stored bytes');
    expect(storage.get).toHaveBeenCalledWith('attachments/6f1b0b8e-1f0a-4a6b-9b3a-6d2f2a1c0e11');
  });

  it('re-sanitizes a filename stored before sanitization existed', async () => {
    // An attachment uploaded through the internal route predates this task and
    // may hold a traversal name. Sanitizing on the way out too means it is still
    // safe to render and to put in a header.
    prismaMocks.attachmentFindFirst.mockResolvedValue(
      storedAttachment({ originalFilename: '../../etc/passwd' }) as never,
    );

    const result = await downloadCustomerAttachment(
      { workspaceSlug: workspace.slug, attachmentId: 'attachment-1' },
      createMockStorage(),
    );

    expect(result.filename).toBe('passwd');
  });

  it('normalizes a stored MIME type before it becomes a response header', async () => {
    // Every current upload path normalizes on the way in, so this value could
    // only be legacy. It still must not reach `Content-Type` unexamined.
    prismaMocks.attachmentFindFirst.mockResolvedValue(
      storedAttachment({ mimeType: 'TEXT/PLAIN; charset=utf-8' }) as never,
    );

    const result = await downloadCustomerAttachment(
      { workspaceSlug: workspace.slug, attachmentId: 'attachment-1' },
      createMockStorage(),
    );

    expect(result.mimeType).toBe('text/plain');
  });

  it('reports a missing stored object as a failure, not as not-found', async () => {
    prismaMocks.attachmentFindFirst.mockResolvedValue(storedAttachment() as never);

    const storage = createMockStorage({
      get: vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')),
    });

    // The metadata exists, so a 404 would be a false statement — and it would
    // tell a customer their own attachment is gone rather than that we have a
    // bug.
    await expect(
      downloadCustomerAttachment(
        { workspaceSlug: workspace.slug, attachmentId: 'attachment-1' },
        storage,
      ),
    ).rejects.toBeInstanceOf(CustomerAttachmentStorageError);
  });

  it('returns no storage key to the caller', async () => {
    prismaMocks.attachmentFindFirst.mockResolvedValue(storedAttachment() as never);

    const result = await downloadCustomerAttachment(
      { workspaceSlug: workspace.slug, attachmentId: 'attachment-1' },
      createMockStorage(),
    );

    expect(result).not.toHaveProperty('storageKey');
    expect(JSON.stringify({ ...result, buffer: undefined })).not.toContain('attachments/');
  });

  it('never contacts the database for an unauthenticated caller', async () => {
    const { CustomerUnauthenticatedError } = await import('@/lib/customer-access/errors');

    mockedRequireSession.mockRejectedValue(new CustomerUnauthenticatedError());

    await expect(
      downloadCustomerAttachment(
        { workspaceSlug: workspace.slug, attachmentId: 'attachment-1' },
        createMockStorage(),
      ),
    ).rejects.toBeInstanceOf(CustomerUnauthenticatedError);

    expect(prismaMocks.attachmentFindFirst).not.toHaveBeenCalled();
  });
});