import { describe, it, expect } from 'vitest';
import { sendEmail, parseEmailProviderConfig } from '@/lib/email/provider';
import type { EmailProviderConfig } from '@/lib/email/provider';

describe('email provider config', () => {
  it('parses a valid resend config', () => {
    expect(parseEmailProviderConfig({ provider: 'resend', from: 'relay@example.com', resendApiKey: 'key' })).toEqual({
      provider: 'resend',
      from: 'relay@example.com',
      resendApiKey: 'key',
    });
  });

  it('rejects invalid config', () => {
    expect(() => parseEmailProviderConfig({ provider: 'resend', from: '' })).toThrow();
  });
});

describe('email provider delivery', () => {
  it('fails permanently when resend api key is missing', async () => {
    const config: EmailProviderConfig = { provider: 'resend', from: 'relay@example.com' };

    const result = await sendEmail(config, {
      to: 'user@example.com',
      subject: 'Ticket assigned',
      text: 'Body',
    });

    expect(result.status).toBe('permanent_failure');
    expect(result.error?.code).toBe('INVALID_CONFIGURATION');
  });

  it('sends in console mode', async () => {
    const config: EmailProviderConfig = { provider: 'console', from: 'relay@example.com' };

    const result = await sendEmail(config, {
      to: 'user@example.com',
      subject: 'Ticket assigned',
      text: 'Body',
    });

    expect(result.status).toBe('success');
  });
});
