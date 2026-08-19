import { Redis } from "ioredis";
import { env } from "@/lib/env";
import { DEFAULT_CONNECTION_OPTIONS } from "@/lib/queue/config";

declare global {
  var queueRedis: Redis | undefined;
}

export const queueRedis: Redis =
  global.queueRedis ?? new Redis(env.REDIS_URL, DEFAULT_CONNECTION_OPTIONS);

if (process.env.NODE_ENV !== "production") {
  global.queueRedis = queueRedis;
}
