/**
 * Collapse volatile numeric fragments so one root cause (OID paths, pids,
 * attempt counters) does not split into hundreds of single-task groups.
 * Must stay equivalent to COMPUTED_OUTBOX_ERROR_SIGNATURE_SQL in the host.
 */
export const normalizeComputedOutboxErrorSignature = (lastError: string | null): string =>
  (lastError ?? '').slice(0, 500).replace(/\d+/g, '#');
