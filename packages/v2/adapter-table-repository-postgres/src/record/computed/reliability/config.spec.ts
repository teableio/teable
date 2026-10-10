import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isComputedReliabilityConfigured,
  isComputedReliabilityEnabled,
  isComputedReliabilityReconciliationEnabled,
  isComputedReliabilityVisible,
} from './config';

describe('computed reliability configuration', () => {
  beforeEach(() => {
    vi.stubEnv('COMPUTED_RELIABILITY_ENABLED', undefined);
    vi.stubEnv('COMPUTED_RELIABILITY_UI_ENABLED', undefined);
    vi.stubEnv('COMPUTED_RELIABILITY_RECONCILIATION_ENABLED', undefined);
    vi.stubEnv('COMPUTED_RELIABILITY_BASE_IDS', undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('defaults capture, display and bounded maintenance to enabled', () => {
    expect(isComputedReliabilityConfigured()).toBe(true);
    expect(isComputedReliabilityEnabled('base-a')).toBe(true);
    expect(isComputedReliabilityVisible('base-a')).toBe(true);
    expect(isComputedReliabilityReconciliationEnabled()).toBe(true);
  });

  it('turns every capability off with the master rollback switch', () => {
    vi.stubEnv('COMPUTED_RELIABILITY_ENABLED', 'false');
    expect(isComputedReliabilityConfigured()).toBe(false);
    expect(isComputedReliabilityEnabled('base-a')).toBe(false);
    expect(isComputedReliabilityVisible('base-a')).toBe(false);
    expect(isComputedReliabilityReconciliationEnabled()).toBe(false);
  });

  it('can disable display and reconciliation without losing failure recording', () => {
    vi.stubEnv('COMPUTED_RELIABILITY_UI_ENABLED', 'false');
    vi.stubEnv('COMPUTED_RELIABILITY_RECONCILIATION_ENABLED', 'false');
    expect(isComputedReliabilityEnabled('base-a')).toBe(true);
    expect(isComputedReliabilityVisible('base-a')).toBe(false);
    expect(isComputedReliabilityReconciliationEnabled()).toBe(false);
  });

  it('limits Bases without disabling the scheduler before routing is resolved', () => {
    vi.stubEnv('COMPUTED_RELIABILITY_BASE_IDS', ' base-a,base-b ');
    expect(isComputedReliabilityConfigured()).toBe(true);
    expect(isComputedReliabilityReconciliationEnabled()).toBe(true);
    expect(isComputedReliabilityEnabled()).toBe(false);
    expect(isComputedReliabilityVisible('base-a')).toBe(true);
    expect(isComputedReliabilityVisible('base-c')).toBe(false);
  });
});
