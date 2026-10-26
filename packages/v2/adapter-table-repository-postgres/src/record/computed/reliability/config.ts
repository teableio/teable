import type { ComputedReliabilityRuntimeConfig } from '../../../config/runtimeConfig';

/**
 * The switches are explicit configuration now: adapters no longer read the host
 * environment, so a browser bundle can import every module. Defaults preserve
 * the documented production behaviour (capture, reconciliation and display on).
 */
const DEFAULT_CONFIG: ComputedReliabilityRuntimeConfig = Object.freeze({
  enabled: true,
  reconciliationEnabled: true,
  uiVisible: true,
});

/** Master switch, independent of whether a caller has resolved a Base yet. */
export const isComputedReliabilityConfigured = (
  config: ComputedReliabilityRuntimeConfig = DEFAULT_CONFIG
): boolean => config.enabled !== false;

export const isComputedReliabilityReconciliationEnabled = (
  config: ComputedReliabilityRuntimeConfig = DEFAULT_CONFIG
): boolean =>
  isComputedReliabilityConfigured(config) && config.reconciliationEnabled !== false;

/** An empty allowlist means every compatible data database. */
export const isComputedReliabilityEnabled = (
  baseId?: string,
  config: ComputedReliabilityRuntimeConfig = DEFAULT_CONFIG
): boolean => {
  if (!isComputedReliabilityConfigured(config)) return false;
  const allowlist = config.baseIds ?? [];
  return allowlist.length === 0 || (baseId !== undefined && allowlist.includes(baseId));
};

export const isComputedReliabilityVisible = (
  baseId?: string,
  config: ComputedReliabilityRuntimeConfig = DEFAULT_CONFIG
): boolean => isComputedReliabilityEnabled(baseId, config) && config.uiVisible !== false;
