import pg from "pg";
import Redis from "ioredis";

const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

let hasFailure = false;

try {
  await client.connect();
  console.log("PostgreSQL OK");
} catch (error) {
  console.error("PostgreSQL check failed:", error.message);
  hasFailure = true;
} finally {
  await client.end().catch(() => {});
}

try {
  const pong = await redis.ping();
  if (pong === "PONG") {
    console.log("Redis OK");
  } else {
    console.error("Redis check failed: unexpected ping response:", pong);
    hasFailure = true;
  }
} catch (error) {
  console.error("Redis check failed:", error.message);
  hasFailure = true;
} finally {
  await redis.quit().catch(() => {});
}

if (hasFailure) {
  process.exitCode = 1;
}
