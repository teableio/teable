/**
 * PostgreSQL has a parameter limit of 65,535 per query.
 * We use 60,000 as a safe upper bound to leave room for other parameters.
 */
const PG_PARAM_SAFE_LIMIT = 60000;

/**
 * Minimum batch size to avoid too many round trips.
 */
const MIN_BATCH_SIZE = 100;

/**
 * Maximum batch size as a reasonable default upper bound.
 */
const DEFAULT_MAX_BATCH_SIZE = 500;

/**
 * Batch UPDATE SQL carries per-row overhead beyond user fields: record id,
 * presence markers, and system metadata columns.
 */
const PER_ROW_SQL_OVERHEAD = 8;

export interface CalculateBatchSizeOptions {
  readonly userBatchSize?: number;
  readonly maxBatchSize?: number;
}

/**
 * Calculates an optimal batch size based on the number of fields.
 *
 * The batch size is dynamically calculated to:
 * 1. Stay within PostgreSQL's parameter limit (65,535)
 * 2. Maintain reasonable memory usage
 * 3. Balance between too many round trips and too large transactions
 *
 * Formula: min(maxBatchSize, max(100, floor(60000 / (fieldCount + overhead))))
 *
 * @param fieldCount - The number of fields in the table
 * @param userBatchSize - Optional user-specified batch size (takes precedence if provided)
 * @returns The calculated batch size
 *
 * @example
 * ```typescript
 * // Table with 10 fields -> batch size 500 (capped at default max)
 * calculateBatchSize(10) // returns 500
 *
 * // Narrow explicit bulk update can opt into a larger cap
 * calculateBatchSize(10, { maxBatchSize: 1000 }) // returns 1000
 *
 * // Table with 100 fields -> batch size 500 (60000/(100+8), capped at default max)
 * calculateBatchSize(100) // returns 500
 *
 * // Table with 200 fields -> batch size 288 (60000/(200+8))
 * calculateBatchSize(200) // returns 288
 *
 * // Table with 1000 fields → batch size 100 (capped at min)
 * calculateBatchSize(1000) // returns 100
 *
 * // User-specified batch size takes precedence within the configured max
 * calculateBatchSize(10, 250) // returns 250
 * ```
 */
export function calculateBatchSize(
  fieldCount: number,
  userBatchSizeOrOptions?: number | CalculateBatchSizeOptions
): number {
  const options =
    typeof userBatchSizeOrOptions === 'number'
      ? { userBatchSize: userBatchSizeOrOptions }
      : userBatchSizeOrOptions ?? {};
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;

  // If user explicitly specified a batch size, use it (but respect min/max bounds)
  if (options.userBatchSize !== undefined) {
    return Math.max(MIN_BATCH_SIZE, Math.min(maxBatchSize, options.userBatchSize));
  }

  // Avoid division by zero
  if (fieldCount <= 0) {
    return maxBatchSize;
  }

  const dynamicSize = Math.floor(PG_PARAM_SAFE_LIMIT / (fieldCount + PER_ROW_SQL_OVERHEAD));
  return Math.max(MIN_BATCH_SIZE, Math.min(maxBatchSize, dynamicSize));
}
