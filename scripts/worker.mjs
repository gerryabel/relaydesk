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
import {
  setWorkerId,
  info,
  warn,
  error as logError,
} from "../src/lib/queue/logger.ts";
import {
  pingRedis,
  getRedisInfo,
  getQueueHealth,
  getRedisConnectionState,
} from "../src/lib/queue/diagnostics.ts";
import { getStartupRecoverySummary } from "../src/lib/queue/recovery.ts";
import { prisma } from "../src/lib/db/prisma.ts";

const QUEUE_NAME = QUEUE_NAMES.primary;
const BULLMQ_QUEUE_NAME = getBullMQQueueName(QUEUE_NAME);
const REDIS_URL = process.env.REDIS_URL;
const DISPATCH_INTERVAL_MS = Number(
  process.env.DISPATCH_INTERVAL_MS ?? 5000,
);

if (!REDIS_URL) {
  logError("REDIS_URL is not set");
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
  logError("Startup connection error", { error: error.message });
});

try {
  await startupConnection.ping();
  info("Redis startup ping succeeded");
} catch (error) {
  logError("Failed to connect to Redis during startup", { error });
  await startupConnection.quit().catch(() => {});
  process.exit(1);
} finally {
  await startupConnection.quit().catch(() => {});
}

const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// ---------------------------------------------------------------------------
// Startup diagnostics: Redis latency, info, queue health.
// Fail-safe — a diagnostics failure is logged but does not prevent the worker
// from starting. The worker must not appear healthy if Redis is broken, but
// these are informational checks beyond the startup ping above.
// ---------------------------------------------------------------------------
try {
  const latencyMs = await pingRedis(connection);
  info("Redis ping latency", { latencyMs });

  const connectionState = getRedisConnectionState(connection);
  info("Redis connection state", { status: connectionState.status });

  const queueHealth = await getQueueHealth(QUEUE_NAME);
  info("Queue health at startup", {
    queueName: queueHealth.queueName,
    waiting: queueHealth.waiting,
    active: queueHealth.active,
    failed: queueHealth.failed,
    delayed: queueHealth.delayed,
    completed: queueHealth.completed,
  });

  // Redis INFO is verbose — log at debug level to avoid leaking internal
  // details into default log streams.
  try {
    const redisInfo = await getRedisInfo(connection);
    info("Redis info", {
      redis_version: redisInfo.redis_version,
      uptime_in_seconds: redisInfo.uptime_in_seconds,
      connected_clients: redisInfo.connected_clients,
      used_memory_human: redisInfo.used_memory_human,
    });
  } catch (infoError) {
    warn("Failed to fetch Redis info", { error: infoError });
  }
} catch (diagError) {
  // Diagnostics failure must be observable but must not block startup.
  warn("Redis diagnostics failed during startup", { error: diagError });
}

// ---------------------------------------------------------------------------
// Startup recovery: report stranded outbox events.
// Deliberately does NOT re-dispatch them — automatic re-dispatch risks a
// thundering herd. Operators recover manually (see docs/phase-6/operations.md).
// ---------------------------------------------------------------------------
try {
  const recovery = await getStartupRecoverySummary(prisma);

  if (recovery.strandedCount > 0) {
    warn("Stranded outbox events detected at startup", {
      strandedCount: recovery.strandedCount,
      strandedEventIds: recovery.strandedEventIds,
      pendingCount: recovery.pendingCount,
      activeLeaseCount: recovery.activeLeaseCount,
      expiredLeaseCount: recovery.expiredLeaseCount,
      failedCount: recovery.failedCount,
      completedCount: recovery.completedCount,
    });
  } else {
    info("Startup recovery check complete", {
      pendingCount: recovery.pendingCount,
      activeLeaseCount: recovery.activeLeaseCount,
      expiredLeaseCount: recovery.expiredLeaseCount,
      failedCount: recovery.failedCount,
      completedCount: recovery.completedCount,
    });
  }
} catch (recoveryError) {
  // Recovery failure must be observable. It does not block worker startup
  // because the dispatcher will still process pending events.
  logError("Startup recovery check failed", { error: recoveryError });
}

// Register the recurring SLA evaluation scheduler.
// upsertJobScheduler is idempotent, so this is safe to call on every
// worker startup. We fail fast if registration fails so the worker does
// not appear healthy without an SLA scheduler.
try {
  await registerSlaEvaluationScheduler(getQueue());
  info("SLA evaluation scheduler registered");
} catch (error) {
  logError("Failed to register SLA evaluation scheduler", { error });
  await connection.quit().catch(() => {});
  process.exit(1);
}

const worker = new Worker(
  BULLMQ_QUEUE_NAME,
  (job) => {
    if (job.name === SLA_EVALUATION_JOB_NAME) {
      info("Processing SLA evaluation job", { jobId: job.id });
      return runSlaEvaluation();
    }

    info("Processing outbox job", {
      jobId: job.id,
      eventType: job.data?.eventType,
      attempt: job.attemptsMade,
      outboxEventId: job.data?.outboxEventId,
    });
    return processOutboxJob(job);
  },
  { connection },
);

// Use the stable BullMQ worker id for all subsequent logs so the worker
// identity is consistent across restarts of the same worker instance.
setWorkerId(worker.id);

worker.on("ready", () => {
  info("Worker ready", { workerId: worker.id, queueName: BULLMQ_QUEUE_NAME });
});

worker.on("error", (error) => {
  logError("Worker error", { error: error.message });
  if (!startupError) {
    startupError = error instanceof Error ? error : new Error(String(error));
  }
});

worker.on("failed", (job, error) => {
  logError("Job failed after exhausting retries", {
    jobId: job?.id,
    eventType: job?.data?.eventType,
    outboxEventId: job?.data?.outboxEventId,
    attempt: job?.attemptsMade,
    error: error.message,
  });
});

worker.on("completed", (job) => {
  info("Job completed", {
    jobId: job.id,
    eventType: job.data?.eventType,
    outboxEventId: job.data?.outboxEventId,
  });
});

async function dispatchTick() {
  if (isShuttingDown || activeDispatch) return;

  activeDispatch = (async () => {
    try {
      const result = await dispatchNextOutboxEvent();

      if (!result.dispatched) {
        info("No outbox event available for dispatch");
      }
    } catch (error) {
      logError("Dispatcher error", { error });
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
  info("Worker shutting down", { signal });
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
    info("Worker shutdown complete");
  } catch (error) {
    logError("Error during shutdown", { error });
    code = 1;
  }

  process.exit(code);
}

process.on("SIGINT", () => shutdown("SIGINT", startupError ? 1 : 0));
process.on("SIGTERM", () => shutdown("SIGTERM", startupError ? 1 : 0));

process.on("uncaughtException", (error) => {
  logError("Uncaught exception", { error });
  void shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled rejection", { error: reason });
  const error = reason instanceof Error ? reason : new Error(String(reason));
  if (!startupError) {
    startupError = error;
  }
  void shutdown("unhandledRejection", 1);
});

startDispatcher();
info("Worker starting", {
  queueName: BULLMQ_QUEUE_NAME,
  dispatchIntervalMs: DISPATCH_INTERVAL_MS,
});
