import { Queue } from "bullmq";
import { queueRedis } from "@/lib/queue/connection";
import { QUEUE_NAMES, type QueueName } from "@/lib/queue/config";

const queues: Partial<Record<QueueName, Queue>> = {};

export function getQueue(name: QueueName = QUEUE_NAMES.primary): Queue {
  if (!queues[name]) {
    queues[name] = new Queue(name, {
      connection: queueRedis,
    });
  }
  return queues[name];
}
