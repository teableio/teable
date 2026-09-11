import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('teable-observability');
export const reliabilityReconciliation = meter.createCounter(
  'v2.computed.reliability.reconciliation',
  { description: 'Reconciliation outcomes; labels never identify a tenant' }
);
export const reliabilityConfirmations = meter.createCounter(
  'v2.computed.reliability.confirmations'
);
let unresolved: number | undefined;
let oldestAge: number | undefined;
meter.createObservableGauge('v2.computed.reliability.unresolved').addCallback((result) => {
  if (unresolved !== undefined) result.observe(unresolved);
});
meter
  .createObservableGauge('v2.computed.reliability.oldest.age', { unit: 'ms' })
  .addCallback((result) => {
    if (oldestAge !== undefined) result.observe(oldestAge);
  });
export const setReliabilitySnapshot = (count?: number, age?: number) => {
  unresolved = count;
  oldestAge = age;
};
