/**
 * Per-base wake-up backoff while a BYODB ledger cannot accept writes.
 *
 * One delayed job per base (not per task): 1m → 5m → 15m → 30m → 60m, then
 * every 60m. The locator is `cuwd-ro-{baseId}-s{step}` so concurrent tasks
 * converge on the same BullMQ jobId. Recovery after the customer restores
 * writability (e.g. a Supabase quota top-up) is a live probe on the sentinel
 * plus the health-lane recovered hook that redrives the target.
 */
export const UNHEALTHY_BYODB_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
] as const;

export type UnhealthyByodbDefer = {
  step: number;
  availableAt: Date;
  wakeupId: string;
};

const MINUTE_MS = 60_000;

export const resolveUnhealthyByodbOrigin = (changedAt: Date | null, nowMs: number): Date => {
  if (changedAt) {
    const origin = changedAt.getTime();
    if (Number.isFinite(origin)) return changedAt;
  }
  return new Date(Math.floor(nowMs / MINUTE_MS) * MINUTE_MS);
};

export const nextUnhealthyByodbDefer = (
  baseId: string,
  changedAt: Date | null,
  nowMs: number
): UnhealthyByodbDefer => {
  const origin = resolveUnhealthyByodbOrigin(changedAt, nowMs).getTime();
  for (let step = 0; step < UNHEALTHY_BYODB_BACKOFF_MS.length; step++) {
    const at = origin + UNHEALTHY_BYODB_BACKOFF_MS[step];
    if (at > nowMs) {
      return { step, availableAt: new Date(at), wakeupId: unhealthyByodbWakeupId(baseId, step) };
    }
  }
  const cap = UNHEALTHY_BYODB_BACKOFF_MS[UNHEALTHY_BYODB_BACKOFF_MS.length - 1];
  const elapsed = Math.max(0, nowMs - origin);
  const cyclesPastCap = Math.floor(elapsed / cap);
  const step = UNHEALTHY_BYODB_BACKOFF_MS.length - 1 + cyclesPastCap;
  return {
    step,
    availableAt: new Date(origin + (cyclesPastCap + 1) * cap),
    wakeupId: unhealthyByodbWakeupId(baseId, step),
  };
};

export const unhealthyByodbWakeupId = (baseId: string, step: number): string =>
  `cuwd-ro-${baseId}-s${step}`;

export const isUnhealthyByodbSentinel = (wakeupId: string, baseId: string): boolean =>
  wakeupId.startsWith(`cuwd-ro-${baseId}-s`);

export const isJobAlreadyExistsError = (error: unknown): boolean => {
  const name = error instanceof Error ? error.name : '';
  if (name === 'JobIdAlreadyExistsError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /job.*(already exists|is already in queue)/i.test(message);
};
