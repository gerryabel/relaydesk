export type { EmailMessage, EmailDeliveryResult } from './types';
export { validateEmailMessage } from './message';
export { EmailProviderError, classifyProviderError } from './errors';
export type { EmailProviderConfig, EmailProviderName } from './provider';
export { parseEmailProviderConfig, sendEmail } from './provider';
