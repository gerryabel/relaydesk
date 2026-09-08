export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailDeliveryResult {
  status: 'success' | 'retryable_failure' | 'permanent_failure' | 'invalid_message';
  providerMessageId?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
