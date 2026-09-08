import { describe, it, expect, vi } from 'vitest';
import { sendEmailWithResend } from '@/lib/email/providers/resend';

function createFetch(fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.fn().mockImplementation(fn);
}

describe('resend provider', () => {
  it('sends a valid message', async () => {
    const fetch = createFetch(async () =>
      new Response(JSON.stringify({ id: 'email-123' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetch);

    const result = await sendEmailWithResend({ apiKey: 'test-api-key', from: 'RelayDesk <relay@example.com>' }, {
      to: 'user@example.com',
      subject: 'Ticket assigned',
      text: 'You have been assigned to ticket-1.',
      html: '<p>You have been assigned to ticket-1.</p>',
    });

    expect(result.status).toBe('success');
    expect(result.providerMessageId).toBe('email-123');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
      }),
    );
  });

  it('classifies recipient errors as permanent failure', async () => {
    const fetch = createFetch(async () => new Response('Invalid recipient', { status: 422 }));
    vi.stubGlobal('fetch', fetch);

    const result = await sendEmailWithResend({ apiKey: 'test-api-key', from: 'RelayDesk <relay@example.com>' }, {
      to: 'invalid@example.com',
      subject: 'Ticket assigned',
      text: 'Body',
    });

    expect(result.status).toBe('permanent_failure');
    expect(result.error?.retryable).toBe(false);
    expect(result.error?.code).toBe('INVALID_RECIPIENT');
  });

  it('classifies provider outages as retryable failure', async () => {
    const fetch = createFetch(async () => new Response('temporarily unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetch);

    const result = await sendEmailWithResend({ apiKey: 'test-api-key', from: 'RelayDesk <relay@example.com>' }, {
      to: 'user@example.com',
      subject: 'Ticket assigned',
      text: 'Body',
    });

    expect(result.status).toBe('retryable_failure');
    expect(result.error?.retryable).toBe(true);
  });
});
