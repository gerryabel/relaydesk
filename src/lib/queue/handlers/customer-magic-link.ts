import { z } from 'zod';
import { env } from '@/lib/env';
import { parseEmailProviderConfig, sendEmail } from '@/lib/email';
import { validateEmailMessage } from '@/lib/email/message';
import { classifyProviderError } from '@/lib/email/errors';
import { RetryableError, PermanentError, classifyDeliveryResult } from '@/lib/queue/errors';
import type { OutboxEventRecord } from '@/lib/outbox/types';
import type { OutboxHandlerResult } from '@/lib/queue/handlers/types';
import {
  claimEmailSend,
  getSentEmail,
  markEmailSent,
  releaseEmailClaim,
} from './email-handler';
import { CUSTOMER_MAGIC_LINK_TTL_MS } from '@/lib/customer-access/config';
import { unsealToken } from '@/lib/customer-access/tokens';

/**
 * Sends the customer magic-link email from the async worker.
 *
 * Reuses the existing email abstraction, `SentEmail` idempotency table and
 * provider error classification. The raw token is unsealed here and nowhere
 * else: the request path only ever persists a digest plus a sealed copy.
 */

const MagicLinkPayloadSchema = z.object({
  workspaceId: z.string().min(1),
  workspaceSlug: z.string().min(1),
  workspaceName: z.string().min(1),
  customerId: z.string().min(1),
  email: z.string().min(1).max(320),
  sealedToken: z.string().min(1),
  expiresAt: z.string().min(1),
});

export function buildCustomerMagicLinkUrl(workspaceSlug: string, token: string): string {
  return `${env.BETTER_AUTH_URL}/portal/${workspaceSlug}/verify?token=${encodeURIComponent(token)}`;
}

export function buildCustomerMagicLinkMessage(input: {
  email: string;
  workspaceName: string;
  magicLinkUrl: string;
  expiresAt: Date;
}) {
  const minutes = Math.max(1, Math.round(CUSTOMER_MAGIC_LINK_TTL_MS / 60_000));

  return validateEmailMessage({
    to: input.email,
    subject: `Sign in to ${input.workspaceName}`,
    text: [
      `You requested a sign-in link for ${input.workspaceName}.`,
      '',
      `Open this link to continue (it expires in ${minutes} minutes and can be used once):`,
      input.magicLinkUrl,
      '',
      'If you did not request this, you can ignore this email.',
    ].join('\n'),
  });
}

export async function handleCustomerMagicLinkEvent(
  event: OutboxEventRecord,
): Promise<OutboxHandlerResult> {
  if (event.eventType !== 'CUSTOMER_MAGIC_LINK_REQUESTED' || event.aggregateType !== 'Customer') {
    return {
      status: 'failure',
      error: { message: `Unsupported email event: ${event.eventType}`, retryable: false },
    };
  }

  const parsed = MagicLinkPayloadSchema.safeParse(event.payload);

  if (!parsed.success) {
    return {
      status: 'failure',
      error: { message: `Invalid customer magic link payload for event ${event.id}`, retryable: false },
    };
  }

  const payload = parsed.data;

  if (await getSentEmail(event.id)) {
    return { status: 'success' };
  }

  let rawToken: string;
  try {
    rawToken = unsealToken(payload.sealedToken, env.BETTER_AUTH_SECRET);
  } catch {
    return {
      status: 'failure',
      error: { message: `Customer magic link token could not be opened for event ${event.id}`, retryable: false },
    };
  }

  const expiresAt = new Date(payload.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return {
      status: 'failure',
      error: { message: `Customer magic link expiry is invalid for event ${event.id}`, retryable: false },
    };
  }

  const message = buildCustomerMagicLinkMessage({
    email: payload.email,
    workspaceName: payload.workspaceName,
    magicLinkUrl: buildCustomerMagicLinkUrl(payload.workspaceSlug, rawToken),
    expiresAt,
  });

  const claim = await claimEmailSend(event.id, message.to);
  if (!claim.claimed) {
    return { status: 'success' };
  }

  const config = parseEmailProviderConfig({
    provider: process.env.EMAIL_PROVIDER ?? 'console',
    from: process.env.EMAIL_FROM ?? 'RelayDesk <no-reply@example.com>',
    resendApiKey: process.env.RESEND_API_KEY ?? '',
  });

  try {
    const providerResult = await sendEmail(config, message);

    if (providerResult.status === 'success') {
      await markEmailSent(event.id);
      return { status: 'success' };
    }

    await releaseEmailClaim(event.id);

    if (providerResult.status === 'retryable_failure') {
      throw classifyDeliveryResult(providerResult);
    }

    return {
      status: 'failure',
      error: {
        message: providerResult.error?.message ?? 'Email provider permanently rejected the magic link',
        retryable: false,
      },
    };
  } catch (error) {
    if (error instanceof RetryableError || error instanceof PermanentError) {
      throw error;
    }

    const classification = classifyProviderError(error);
    await releaseEmailClaim(event.id);

    if (!classification.retryable) {
      return {
        status: 'failure',
        error: { message: classification.message, retryable: false },
      };
    }

    throw new RetryableError(classification.message);
  }
}
