import { Redis } from "ioredis";
import { env } from "@/lib/env";
import { DEFAULT_CONNECTION_OPTIONS } from "@/lib/queue/config";

declare global {
  var queueRedis: Redis | undefined;
}

export function getQueueRedis(): Redis {
  if (!global.queueRedis) {
    global.queueRedis = new Redis(env.REDIS_URL, DEFAULT_CONNECTION_OPTIONS);
  }

  return global.queueRedis;
}

export const queueRedis: Redis = getQueueRedis();
