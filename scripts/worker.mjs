import "dotenv/config";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { QUEUE_NAMES, getBullMQQueueName } from "../src/lib/queue/constants.js";
import { getQueue } from "../src/lib/queue/producer.ts";
import { processOutboxJob } from "../src/lib/queue/worker.ts";
import { dispatchNextOutboxEvent } from "../src/lib/queue/dispatcher.ts";
import { runSlaEvaluation } from "../src/lib/sla/evaluation.ts";
import {
  registerSlaEvaluationScheduler,
  SLA_EVALUATION_JOB_NAME,
} from "../src/lib/sla/scheduler.ts";

const QUEUE_NAME = QUEUE_NAMES.primary;
const BULLMQ_QUEUE_NAME = getBullMQQueueName(QUEUE_NAME);
const REDIS_URL = process.env.REDIS_URL;
const DISPATCH_INTERVAL_MS = Number(
  process.env.DISPATCH_INTERVAL_MS ?? 5000,
);

if (!REDIS_URL) {
  console.error("[worker] REDIS_URL is not set");
  process.exit(1);
}

let isShuttingDown = false;
let startupError;
let dispatchTimer = null;
let activeDispatch = null;

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

// Register the recurring SLA evaluation scheduler.
// upsertJobScheduler is idempotent, so this is safe to call on every
// worker startup. We fail fast if registration fails so the worker does
// not appear healthy without an SLA scheduler.
try {
  await registerSlaEvaluationScheduler(getQueue());
  console.log("[worker] SLA evaluation scheduler registered");
} catch (error) {
  console.error(
    "[worker] Failed to register SLA evaluation scheduler:",
    error instanceof Error ? error.message : error,
  );
  await connection.quit().catch(() => {});
  process.exit(1);
}

const worker = new Worker(
  BULLMQ_QUEUE_NAME,
  (job) => {
    console.log(`[worker] Processing job ${job.id} (${job.name})`);
    if (job.name === SLA_EVALUATION_JOB_NAME) {
      return runSlaEvaluation();
    }
    return processOutboxJob(job);
  },
  { connection }
);

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

async function dispatchTick() {
  if (isShuttingDown || activeDispatch) return;

  activeDispatch = (async () => {
    try {
      const result = await dispatchNextOutboxEvent();

      if (result.dispatched) {
        console.log(
          `[dispatcher] Dispatched outbox event ${result.eventId}`,
        );
      }
    } catch (error) {
      console.error(
        "[dispatcher] Error:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      activeDispatch = null;
    }
  })();

  await activeDispatch;
}

function startDispatcher() {
  dispatchTimer = setInterval(dispatchTick, DISPATCH_INTERVAL_MS);
}

async function shutdown(signal, code = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[worker] Received ${signal}, shutting down...`);
  try {
    if (dispatchTimer) {
      clearInterval(dispatchTimer);
      dispatchTimer = null;
    }
    if (activeDispatch) {
      try {
        await activeDispatch;
      } catch {
        // ignore dispatch errors during shutdown
      }
    }
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

startDispatcher();
console.log("[worker] Starting...");
