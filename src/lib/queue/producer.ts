import { Queue } from "bullmq";
import { queueRedis } from "@/lib/queue/connection";
import { QUEUE_NAMES, getBullMQQueueName } from "@/lib/queue/config";

const queues: Record<string, Queue> = {};

export function getQueue(name = QUEUE_NAMES.primary): Queue {
  const bullMQName = getBullMQQueueName(name);
  if (!queues[bullMQName]) {
    queues[bullMQName] = new Queue(bullMQName, {
      connection: queueRedis,
    });
  }
  return queues[bullMQName];
}
