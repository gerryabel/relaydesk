import pg from "pg";
import Redis from "ioredis";
import { Queue } from "bullmq";

const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

if (!process.env.REDIS_URL) {
  console.error("Redis check failed: REDIS_URL is not set");
  process.exit(1);
}

const BULLMQ_QUEUE_NAME = process.env.BULLMQ_QUEUE_NAME ?? "relaydesk-primary";

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1,
});

let hasFailure = false;

try {
  await client.connect();
  console.log("PostgreSQL: OK");
} catch (error) {
  console.error(
    "PostgreSQL: FAILED —",
    error instanceof Error ? error.message : error,
  );
  hasFailure = true;
} finally {
  await client.end().catch(() => {});
}

try {
  const start = process.hrtime.bigint();
  const pong = await redis.ping();
  const end = process.hrtime.bigint();
  const latencyMs = Number(end - start) / 1_000_000;

  if (pong === "PONG") {
    console.log(`Redis: OK (ping ${latencyMs.toFixed(2)} ms)`);
  } else {
    console.error("Redis: FAILED — unexpected ping response:", pong);
    hasFailure = true;
  }
} catch (error) {
  console.error(
    "Redis: FAILED —",
    error instanceof Error ? error.message : error,
  );
  hasFailure = true;
}

// Connection state (no credentials exposed — only host/port/family/status).
try {
  const status = redis.status;
  const options = redis.options ?? {};
  const state = {
    status,
    ...(options.host ? { host: options.host } : {}),
    ...(options.port ? { port: options.port } : {}),
    ...(options.family ? { family: options.family } : {}),
  };
  console.log(`Redis connection: ${JSON.stringify(state)}`);
} catch (error) {
  console.error(
    "Redis connection state: FAILED —",
    error instanceof Error ? error.message : error,
  );
  hasFailure = true;
}

// Redis INFO — selected operational fields only.
try {
  const rawInfo = await redis.info();
  const info = parseRedisInfo(rawInfo);
  console.log(
    `Redis info: version=${info.redis_version} uptime=${info.uptime_in_seconds}s clients=${info.connected_clients} memory=${info.used_memory_human}`,
  );
} catch (error) {
  console.error(
    "Redis info: FAILED —",
    error instanceof Error ? error.message : error,
  );
  hasFailure = true;
}

// Queue health / depth via BullMQ getJobCounts (O(1) per state).
try {
  const queue = new Queue(BULLMQ_QUEUE_NAME, { connection: redis });
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
  );
  await queue.close().catch(() => {});

  console.log(
    `Queue "${BULLMQ_QUEUE_NAME}": waiting=${counts.waiting ?? 0} active=${counts.active ?? 0} completed=${counts.completed ?? 0} failed=${counts.failed ?? 0} delayed=${counts.delayed ?? 0}`,
  );

  // A large failed count is a warning sign but not necessarily a hard failure
  // for the infra check — report it clearly either way.
  if ((counts.failed ?? 0) > 0) {
    console.warn(
      `Queue warning: ${counts.failed} failed job(s) in "${BULLMQ_QUEUE_NAME}"`,
    );
  }
} catch (error) {
  console.error(
    `Queue health (${BULLMQ_QUEUE_NAME}): FAILED —`,
    error instanceof Error ? error.message : error,
  );
  hasFailure = true;
}

await redis.quit().catch(() => {});

if (hasFailure) {
  process.exit(1);
}

/**
 * Parse a Redis INFO response string into a flat key-value map, grouped by
 * section header (e.g. "# Server").
 */
function parseRedisInfo(raw) {
  const sections = {};
  let current = "server";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("# ")) {
      current = trimmed.slice(2).trim().toLowerCase();
      continue;
    }

    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1);
    if (!sections[current]) sections[current] = {};
    sections[current][key] = value;
  }

  const server = sections.server ?? {};
  const memory = sections.memory ?? {};
  const stats = sections.stats ?? {};

  return {
    redis_version: server.redis_version ?? "unknown",
    uptime_in_seconds: server.uptime_in_seconds ?? "0",
    connected_clients: server.connected_clients ?? "0",
    used_memory_human: memory.used_memory_human ?? "0B",
    keyspace_hits: stats.keyspace_hits ?? "0",
    keyspace_misses: stats.keyspace_misses ?? "0",
  };
}
