import { describe, expect, it } from 'vitest';

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
});
