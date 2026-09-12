import { z } from 'zod';
import type { EmailMessage } from './types';

const emailSchema = z.object({
  to: z.string().trim().min(1, 'Recipient email is required').max(320, 'Recipient email is too long'),
  subject: z.string().trim().min(1, 'Subject is required').max(200, 'Subject is too long'),
  text: z.string().trim().min(1, 'Body is required').max(20000, 'Body is too long'),
  html: z.string().trim().max(50000, 'HTML body is too long').optional(),
});

export function validateEmailMessage(message: EmailMessage) {
  return emailSchema.parse(message);
}
