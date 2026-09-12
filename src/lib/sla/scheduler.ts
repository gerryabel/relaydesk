import type { Queue } from "bullmq";
import { DEFAULT_RETRY_POLICY } from "@/lib/queue/retry-policy";

export const SLA_SCHEDULER_ID = "sla-evaluation-scheduler";
export const SLA_EVALUATION_JOB_NAME = "SLA_EVALUATION";
export const DEFAULT_SLA_CRON_PATTERN = "*/5 * * * *";

export interface SlaSchedulerRetryOptions {
  attempts: number;
  backoffType: "fixed" | "exponential";
  backoffDelayMs: number;
}

export function buildSlaSchedulerRetryOptions(
  policy: SlaSchedulerRetryOptions = {
    attempts: DEFAULT_RETRY_POLICY.maxAttempts,
    backoffType: DEFAULT_RETRY_POLICY.backoffType,
    backoffDelayMs: DEFAULT_RETRY_POLICY.backoffDelayMs,
  },
): {
  attempts: number;
  backoff: { type: "fixed" | "exponential"; delay: number };
} {
  return {
    attempts: policy.attempts,
    backoff: {
      type: policy.backoffType,
      delay: policy.backoffDelayMs,
    },
  };
}

/**
 * Registers the recurring SLA evaluation job on the given BullMQ queue.
 *
 * Uses BullMQ v6's upsertJobScheduler, which is idempotent: calling it
 * repeatedly with the same scheduler ID updates the existing scheduler
 * rather than creating duplicates. Safe to call on every worker startup.
 *
 * @throws if registration fails — callers should fail fast rather than
 * start a worker that appears healthy but has no SLA scheduler.
 */
export async function registerSlaEvaluationScheduler(
  queue: Queue,
  pattern: string = DEFAULT_SLA_CRON_PATTERN,
): Promise<void> {
  const retryOpts = buildSlaSchedulerRetryOptions();

  await queue.upsertJobScheduler(
    SLA_SCHEDULER_ID,
    { pattern },
    {
      name: SLA_EVALUATION_JOB_NAME,
      data: {},
      opts: {
        attempts: retryOpts.attempts,
        backoff: retryOpts.backoff,
        removeOnComplete: true,
        removeOnFail: 10,
      },
    },
  );
}
