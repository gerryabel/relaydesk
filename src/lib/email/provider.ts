import { z } from 'zod';
import type { EmailMessage, EmailDeliveryResult } from './types';
import { sendEmailWithResend } from './providers/resend';

export type EmailProviderName = 'resend' | 'console';

export interface EmailProviderConfig {
  provider: EmailProviderName;
  from: string;
  resendApiKey?: string;
}

const configSchema = z.object({
  provider: z.enum(['resend', 'console']),
  from: z.string().min(1, 'EMAIL_FROM is required').max(320, 'EMAIL_FROM is too long'),
  resendApiKey: z.string().optional(),
});

export function parseEmailProviderConfig(input: unknown): EmailProviderConfig {
  return configSchema.parse(input);
}

export async function sendEmail(config: EmailProviderConfig, message: EmailMessage): Promise<EmailDeliveryResult> {
  if (config.provider === 'resend') {
    if (!config.resendApiKey) {
      return {
        status: 'permanent_failure',
        error: {
          code: 'INVALID_CONFIGURATION',
          message: 'RESEND_API_KEY is not configured',
          retryable: false,
        },
      };
    }

    return sendEmailWithResend({ apiKey: config.resendApiKey, from: config.from }, message);
  }

  console.log('[email:console]', JSON.stringify({ to: message.to, subject: message.subject, text: message.text }));
  return { status: 'success' };
}
