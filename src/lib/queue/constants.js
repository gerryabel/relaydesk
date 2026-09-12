/** @typedef {"primary"} QueueName */

export const QUEUE_NAMES = {
  primary: "relaydesk:primary",
};

export const DEFAULT_CONNECTION_OPTIONS = {
  maxRetriesPerRequest: null,
};

export function getBullMQQueueName(name) {
  return name.replace(/:/g, "-");
}
