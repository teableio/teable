const READ_BATCH_TARGET_BYTES = 8 * 1024 * 1024;
/** a single multi-MB row must stay readable one at a time */
const READ_BATCH_MIN_ROWS = 1;

/**
 * First batch of a table probes the row weight before trusting the full cap.
 * Kept small: a table can average 500KB/row (real on the ai fleet), so a large
 * probe materializes hundreds of MB before the adaptive limit kicks in.
 */
export const READ_BATCH_PROBE_ROWS = 64;

/**
 * Rows for the next batch so ~READ_BATCH_TARGET_BYTES come back whatever the
 * row weight: a row-count LIMIT alone lets one fat-JSON table materialize
 * gigabytes in a single batch. `cap` stays the hard ceiling, so an operator who
 * lowered readBatchSize to cut memory pressure keeps it.
 */
export const nextReadBatchLimit = (batchBytes: number, batchRows: number, cap: number): number => {
  const avgRowBytes = Math.max(1, Math.ceil(batchBytes / Math.max(1, batchRows)));
  const target = Math.floor(READ_BATCH_TARGET_BYTES / avgRowBytes);
  return Math.min(cap, Math.max(READ_BATCH_MIN_ROWS, target));
};
