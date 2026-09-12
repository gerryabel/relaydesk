import type { EmailMessage, EmailDeliveryResult } from '../types';
import { classifyProviderError } from '../errors';

export interface ResendProviderOptions {
  apiKey: string;
  from: string;
}

export async function sendEmailWithResend({ apiKey, from }: ResendProviderOptions, message: EmailMessage): Promise<EmailDeliveryResult> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });

  if (response.ok) {
    const data = (await response.json().catch(() => ({}))) as { id?: string };
    return { status: 'success', providerMessageId: data.id };
  }

  const body = await response.text().catch(() => '');
  const error = new Error(`Resend provider error ${response.status}: ${body || response.statusText}`);
  const classified = classifyProviderError(error);

  return {
    status: classified.retryable ? 'retryable_failure' : 'permanent_failure',
    error: {
      code: classified.code,
      message: classified.message,
      retryable: classified.retryable,
    },
  };
}
