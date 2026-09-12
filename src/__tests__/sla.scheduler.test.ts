import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerSlaEvaluationScheduler,
  buildSlaSchedulerRetryOptions,
  SLA_SCHEDULER_ID,
  SLA_EVALUATION_JOB_NAME,
  DEFAULT_SLA_CRON_PATTERN,
} from "@/lib/sla/scheduler";

describe("SLA evaluation scheduler", () => {
  describe("constants", () => {
    it("uses a stable deterministic scheduler ID", () => {
      expect(SLA_SCHEDULER_ID).toBe("sla-evaluation-scheduler");
    });

    it("uses SLA_EVALUATION as the job name", () => {
      expect(SLA_EVALUATION_JOB_NAME).toBe("SLA_EVALUATION");
    });

    it("defaults to every-5-minutes cron pattern", () => {
      expect(DEFAULT_SLA_CRON_PATTERN).toBe("*/5 * * * *");
    });
  });

  describe("buildSlaSchedulerRetryOptions", () => {
    it("returns exponential backoff by default", () => {
      const opts = buildSlaSchedulerRetryOptions();
      expect(opts.attempts).toBeGreaterThan(0);
      expect(opts.backoff).toEqual({
        type: "exponential",
        delay: expect.any(Number),
      });
    });

    it("accepts custom retry policy", () => {
      const opts = buildSlaSchedulerRetryOptions({
        attempts: 5,
        backoffType: "fixed",
        backoffDelayMs: 1000,
      });
      expect(opts.attempts).toBe(5);
      expect(opts.backoff).toEqual({ type: "fixed", delay: 1000 });
    });
  });

  describe("registerSlaEvaluationScheduler", () => {
    let queue: {
      upsertJobScheduler: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      queue = {
        upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
      };
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("calls upsertJobScheduler with correct scheduler ID", async () => {
      await registerSlaEvaluationScheduler(queue as never);
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        SLA_SCHEDULER_ID,
        { pattern: DEFAULT_SLA_CRON_PATTERN },
        expect.objectContaining({
          name: SLA_EVALUATION_JOB_NAME,
          data: {},
          opts: expect.objectContaining({
            attempts: expect.any(Number),
            backoff: expect.objectContaining({
              type: expect.any(String),
              delay: expect.any(Number),
            }),
          }),
        }),
      );
    });

    it("uses the default cron pattern", async () => {
      await registerSlaEvaluationScheduler(queue as never);
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        expect.any(String),
        { pattern: "*/5 * * * *" },
        expect.any(Object),
      );
    });

    it("accepts a configurable cron pattern", async () => {
      await registerSlaEvaluationScheduler(queue as never, "0 */1 * * *");
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        expect.any(String),
        { pattern: "0 */1 * * *" },
        expect.any(Object),
      );
    });

    it("passes retry options in the job template", async () => {
      await registerSlaEvaluationScheduler(queue as never);
      const call = queue.upsertJobScheduler.mock.calls[0];
      const jobTemplate = call[2];
      expect(jobTemplate.opts.removeOnComplete).toBe(true);
      expect(jobTemplate.opts.removeOnFail).toBe(10);
    });

    it("does NOT use the legacy queue.add with repeat option", async () => {
      await registerSlaEvaluationScheduler(queue as never);
      // queue.add should never be called — only upsertJobScheduler
      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    });
  });
});
