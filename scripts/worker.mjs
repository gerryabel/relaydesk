import "dotenv/config";
import { Worker } from "bullmq";
import Redis from "ioredis";

const QUEUE_NAME = "relaydesk-primary";
const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error("[worker] REDIS_URL is not set");
  process.exit(1);
}

let isShuttingDown = false;

const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`[worker] Processing job ${job.id} (${job.name})`);
    // Placeholder handler — Task 3 replaces this with the real dispatcher.
    return { processed: true };
  },
  { connection }
);

worker.on("ready", () => {
  console.log("[worker] Ready");
});

worker.on("error", (error) => {
  console.error("[worker] Error:", error.message);
});

worker.on("failed", (job, error) => {
  console.error(`[worker] Job ${job?.id} failed:`, error.message);
});

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[worker] Received ${signal}, shutting down...`);
  try {
    await worker.close();
    await connection.quit();
    console.log("[worker] Shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error("[worker] Error during shutdown:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log("[worker] Starting...");
