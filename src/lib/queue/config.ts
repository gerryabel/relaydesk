export const QUEUE_NAMES = {
  primary: "relaydesk-primary",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const DEFAULT_CONNECTION_OPTIONS = {
  maxRetriesPerRequest: null,
} as const;
