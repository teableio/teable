import { describe, expect, it } from 'vitest';

import {
  isComputedReliabilityConfigured,
  isComputedReliabilityEnabled,
  isComputedReliabilityReconciliationEnabled,
  isComputedReliabilityVisible,
} from './config';

describe('computed reliability configuration', () => {
  it('defaults capture, display and bounded maintenance to enabled', () => {
    expect(isComputedReliabilityConfigured()).toBe(true);
    expect(isComputedReliabilityEnabled('base-a')).toBe(true);
    expect(isComputedReliabilityVisible('base-a')).toBe(true);
    expect(isComputedReliabilityReconciliationEnabled()).toBe(true);
  });

  it('turns every capability off with the master rollback switch', () => {
    const config = { enabled: false };
    expect(isComputedReliabilityConfigured(config)).toBe(false);
    expect(isComputedReliabilityEnabled('base-a', config)).toBe(false);
    expect(isComputedReliabilityVisible('base-a', config)).toBe(false);
    expect(isComputedReliabilityReconciliationEnabled(config)).toBe(false);
  });

  it('can disable display and reconciliation without losing failure recording', () => {
    const config = { uiVisible: false, reconciliationEnabled: false };
    expect(isComputedReliabilityEnabled('base-a', config)).toBe(true);
    expect(isComputedReliabilityVisible('base-a', config)).toBe(false);
    expect(isComputedReliabilityReconciliationEnabled(config)).toBe(false);
  });

  it('limits Bases without disabling the scheduler before routing is resolved', () => {
    const config = { baseIds: ['base-a', 'base-b'] };
    expect(isComputedReliabilityConfigured(config)).toBe(true);
    expect(isComputedReliabilityReconciliationEnabled(config)).toBe(true);
    expect(isComputedReliabilityEnabled(undefined, config)).toBe(false);
    expect(isComputedReliabilityVisible('base-a', config)).toBe(true);
    expect(isComputedReliabilityVisible('base-c', config)).toBe(false);
  });
});
