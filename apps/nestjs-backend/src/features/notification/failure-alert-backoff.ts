/**
 * How often a repeatedly-failing resource is allowed to notify its owner.
 *
 * Every failure of an automation or a routine bumps a counter; this
 * decides which counts actually send. The ladder alerts on each of the first
 * few failures, then backs off geometrically, so a resource stuck failing every
 * minute stays visible without filling the owner's inbox:
 *
 *   1, 2, 3, 4, 5, 10, 20, 40, 80, 160, 320, 640, 1280 …
 *
 * The cadence is a product decision — keep it here rather than per feature, so
 * tuning it cannot leave one caller on the old ladder.
 */

/** Failures up to this count alert every time; past it the ladder backs off. */
export const FAILURE_ALERT_PER_RUN_LIMIT = 5;

/** Where the backoff switches from "every failure" to "powers of two × 10". */
const FAILURE_ALERT_BACKOFF_BASE = 10;

export const shouldSendFailureNotification = (failCount: number): boolean => {
  if (failCount <= FAILURE_ALERT_PER_RUN_LIMIT) return true;
  if (failCount < FAILURE_ALERT_BACKOFF_BASE) return false;
  const ratio = failCount / FAILURE_ALERT_BACKOFF_BASE;
  return Number.isInteger(ratio) && Number.isInteger(Math.log2(ratio));
};

/**
 * Past the per-run limit the alert stops being about one failure and becomes a
 * summary of the streak — callers use this to pick the wording and to deep-link
 * at the resource instead of a single run.
 */
export const isFailureStreakSummary = (failCount: number): boolean =>
  failCount > FAILURE_ALERT_PER_RUN_LIMIT;
