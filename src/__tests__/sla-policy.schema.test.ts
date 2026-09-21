import { describe, it, expect } from 'vitest';
import {
  slaPolicyInputSchema,
  MAX_SLA_MINUTES,
  ALL_PRIORITIES,
} from '@/lib/workspace/sla-policy';
import type { SlaPolicyInput } from '@/lib/workspace/sla-policy';

function makeValidPayload(): SlaPolicyInput {
  return [
    { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 },
    { priority: 'medium', responseMinutes: 480, resolutionMinutes: 4320 },
    { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
    { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
  ];
}

describe('slaPolicyInputSchema — required structure', () => {
  it('accepts a complete, valid four-policy payload', () => {
    const result = slaPolicyInputSchema.safeParse(makeValidPayload());
    expect(result.success).toBe(true);
  });

  it('requires exactly four entries', () => {
    const three = makeValidPayload().slice(0, 3);
    const result = slaPolicyInputSchema.safeParse(three);
    expect(result.success).toBe(false);
  });

  it('rejects more than four entries', () => {
    const five = [
      ...makeValidPayload(),
      { priority: 'urgent', responseMinutes: 1, resolutionMinutes: 1 },
    ];
    const result = slaPolicyInputSchema.safeParse(five);
    expect(result.success).toBe(false);
  });

  it('rejects an empty payload', () => {
    const result = slaPolicyInputSchema.safeParse([]);
    expect(result.success).toBe(false);
  });
});

describe('slaPolicyInputSchema — priority uniqueness', () => {
  it('rejects duplicate priorities', () => {
    const payload = [
      { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 },
      { priority: 'low', responseMinutes: 480, resolutionMinutes: 4320 },
      { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
      { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
    ];
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.join(' ')).toContain('Duplicate priority: low');
    }
  });

  it('rejects a missing priority even when four entries are present', () => {
    const payload = [
      { priority: 'low', responseMinutes: 1440, resolutionMinutes: 7200 },
      { priority: 'medium', responseMinutes: 480, resolutionMinutes: 4320 },
      { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
      { priority: 'high', responseMinutes: 120, resolutionMinutes: 600 },
    ];
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.join(' ')).toContain('Missing priority: urgent');
    }
  });

  it('requires all four canonical priorities', () => {
    for (const priority of ALL_PRIORITIES) {
      expect(priority).toBeTruthy();
    }
    expect(ALL_PRIORITIES).toHaveLength(4);
  });
});

describe('slaPolicyInputSchema — value bounds', () => {
  it('rejects zero response minutes', () => {
    const payload = makeValidPayload();
    payload[0] = { priority: 'low', responseMinutes: 0, resolutionMinutes: 7200 };
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects negative response minutes', () => {
    const payload = makeValidPayload();
    payload[0] = { priority: 'low', responseMinutes: -5, resolutionMinutes: 7200 };
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects zero resolution minutes', () => {
    const payload = makeValidPayload();
    payload[1] = { priority: 'medium', responseMinutes: 480, resolutionMinutes: 0 };
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects negative resolution minutes', () => {
    const payload = makeValidPayload();
    payload[2] = { priority: 'high', responseMinutes: 240, resolutionMinutes: -1 };
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects non-integer response minutes', () => {
    const payload = makeValidPayload();
    payload[0] = { priority: 'low', responseMinutes: 1440.5, resolutionMinutes: 7200 };
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects non-integer resolution minutes', () => {
    const payload = makeValidPayload();
    payload[3] = { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240.9 };
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects string-coerced numeric input', () => {
    const payload = [
      { priority: 'low', responseMinutes: '1440', resolutionMinutes: 7200 },
      { priority: 'medium', responseMinutes: 480, resolutionMinutes: 4320 },
      { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
      { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
    ];
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects response minutes above the upper bound', () => {
    const payload = makeValidPayload();
    payload[0] = { priority: 'low', responseMinutes: MAX_SLA_MINUTES + 1, resolutionMinutes: 7200 };
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects resolution minutes above the upper bound', () => {
    const payload = makeValidPayload();
    payload[0] = { priority: 'low', responseMinutes: 1440, resolutionMinutes: MAX_SLA_MINUTES + 1 };
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('accepts response and resolution minutes exactly at the upper bound', () => {
    const payload = makeValidPayload();
    payload[0] = { priority: 'low', responseMinutes: MAX_SLA_MINUTES, resolutionMinutes: MAX_SLA_MINUTES };
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects an unknown priority value', () => {
    const payload = [
      { priority: 'extreme', responseMinutes: 10, resolutionMinutes: 20 },
      { priority: 'medium', responseMinutes: 480, resolutionMinutes: 4320 },
      { priority: 'high', responseMinutes: 240, resolutionMinutes: 1440 },
      { priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 },
    ];
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('accepts a single minute (minimum valid duration)', () => {
    const payload = makeValidPayload();
    payload[3] = { priority: 'urgent', responseMinutes: 1, resolutionMinutes: 1 };
    const result = slaPolicyInputSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
