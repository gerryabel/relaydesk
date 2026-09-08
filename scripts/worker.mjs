import "dotenv/config";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { QUEUE_NAMES, getBullMQQueueName } from "../src/lib/queue/constants.js";

const QUEUE_NAME = QUEUE_NAMES.primary;
const BULLMQ_QUEUE_NAME = getBullMQQueueName(QUEUE_NAME);
const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error("[worker] REDIS_URL is not set");
  process.exit(1);
}

let isShuttingDown = false;

const startupConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 1,
  connectTimeout: 1000,
});

startupConnection.on("error", (error) => {
  console.error("[worker] Startup connection error:", error.message);
});

try {
  await startupConnection.ping();
} catch (error) {
  console.error("[worker] Failed to connect to Redis:", error instanceof Error ? error.message : error);
  await startupConnection.quit().catch(() => {});
  process.exit(1);
} finally {
  await startupConnection.quit().catch(() => {});
}

const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  BULLMQ_QUEUE_NAME,
  async (job) => {
    console.log(`[worker] Processing job ${job.id} (${job.name})`);
    // Placeholder handler — Task 3 replaces this with the real dispatcher.
    return { processed: true };
  },
  { connection }
);

let startupError;

worker.on("ready", () => {
  console.log("[worker] Ready");
});

worker.on("error", (error) => {
  console.error("[worker] Error:", error.message);
  if (!startupError) {
    startupError = error instanceof Error ? error : new Error(String(error));
  }
});

worker.on("failed", (job, error) => {
  console.error(`[worker] Job ${job?.id} failed:`, error.message);
});

async function shutdown(signal, code = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[worker] Received ${signal}, shutting down...`);
  try {
    await worker.close();
    await connection.quit();
    console.log("[worker] Shutdown complete");
  } catch (error) {
    console.error("[worker] Error during shutdown:", error);
    code = 1;
  }

  process.exit(code);
}

process.on("SIGINT", () => shutdown("SIGINT", startupError ? 1 : 0));
process.on("SIGTERM", () => shutdown("SIGTERM", startupError ? 1 : 0));

process.on("uncaughtException", (error) => {
  console.error("[worker] Uncaught exception:", error);
  void shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[worker] Unhandled rejection:", reason);
  const error = reason instanceof Error ? reason : new Error(String(reason));
  if (!startupError) {
    startupError = error;
  }
  void shutdown("unhandledRejection", 1);
});

console.log("[worker] Starting...");
