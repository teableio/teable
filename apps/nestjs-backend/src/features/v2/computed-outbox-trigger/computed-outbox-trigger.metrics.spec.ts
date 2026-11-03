import { describe, expect, it, vi } from 'vitest';

import { ComputedOutboxTriggerMetrics } from './computed-outbox-trigger.metrics';

describe('ComputedOutboxTriggerMetrics', () => {
  it('labels recent runtime activity as process-local', () => {
    const metrics = new ComputedOutboxTriggerMetrics();

    metrics.recordConsume('processed');

    expect(metrics.getRuntimeSnapshot()).toMatchObject({
      scope: 'process',
      lastConsumeOutcome: 'processed',
    });
  });

  it('records source-to-settlement latency with bounded task labels only', () => {
    const metrics = new ComputedOutboxTriggerMetrics();
    // The public method owns labels; observe its OTel instrument without replacing the meter.
    const testAccess = metrics as unknown as {
      sourceToSettlement: { record(value: number, attributes: Record<string, unknown>): void };
    };
    const histogram = testAccess.sourceToSettlement;
    const record = vi.spyOn(histogram, 'record');

    metrics.recordTaskSettlement({
      taskKind: 'computed',
      sourceToSettlementMs: -5,
      continued: true,
    });

    expect(record).toHaveBeenCalledWith(0, {
      taskKind: 'computed',
      continued: true,
    });
  });

  it('records admission lease loss stop latency without high-cardinality attributes', () => {
    const metrics = new ComputedOutboxTriggerMetrics();
    const testAccess = metrics as unknown as {
      admissionLeaseLossStopDuration: {
        record(value: number, attributes?: Record<string, unknown>): void;
      };
    };
    const record = vi.spyOn(testAccess.admissionLeaseLossStopDuration, 'record');

    metrics.recordAdmissionLeaseLossStop(-1);

    expect(record).toHaveBeenCalledWith(0);
  });
});
