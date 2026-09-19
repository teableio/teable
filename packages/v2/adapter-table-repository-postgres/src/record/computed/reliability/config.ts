/** Default on after storage readiness checks; explicit flags still support rollback. */
const enabled = (value: string | undefined): boolean => value === undefined || value === 'true';

/** Master switch, independent of whether a caller has resolved a Base yet. */
export const isComputedReliabilityConfigured = (): boolean =>
  enabled(process.env.COMPUTED_RELIABILITY_ENABLED);

export const isComputedReliabilityReconciliationEnabled = (): boolean =>
  isComputedReliabilityConfigured() &&
  enabled(process.env.COMPUTED_RELIABILITY_RECONCILIATION_ENABLED);

/** An empty allowlist means every compatible data database. */
export const isComputedReliabilityEnabled = (baseId?: string): boolean => {
  if (!isComputedReliabilityConfigured()) return false;
  const allowlist = (process.env.COMPUTED_RELIABILITY_BASE_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return allowlist.length === 0 || (baseId !== undefined && allowlist.includes(baseId));
};

export const isComputedReliabilityVisible = (baseId?: string): boolean =>
  isComputedReliabilityEnabled(baseId) && enabled(process.env.COMPUTED_RELIABILITY_UI_ENABLED);
