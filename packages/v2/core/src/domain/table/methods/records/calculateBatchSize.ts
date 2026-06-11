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
 * Maximum batch size as a reasonable upper bound.
 */
const MAX_BATCH_SIZE = 500;

/**
 * Calculates an optimal batch size based on the number of fields.
 *
 * The batch size is dynamically calculated to:
 * 1. Stay within PostgreSQL's parameter limit (65,535)
 * 2. Maintain reasonable memory usage
 * 3. Balance between too many round trips and too large transactions
 *
 * Formula: min(500, max(100, floor(60000 / fieldCount)))
 *
 * @param fieldCount - The number of fields in the table
 * @param userBatchSize - Optional user-specified batch size (takes precedence if provided)
 * @returns The calculated batch size
 *
 * @example
 * ```typescript
 * // Table with 10 fields → batch size 500 (capped at max)
 * calculateBatchSize(10) // returns 500
 *
 * // Table with 100 fields → batch size 500 (60000/100 = 600, capped at 500)
 * calculateBatchSize(100) // returns 500
 *
 * // Table with 200 fields → batch size 300 (60000/200 = 300)
 * calculateBatchSize(200) // returns 300
 *
 * // Table with 1000 fields → batch size 100 (capped at min)
 * calculateBatchSize(1000) // returns 100
 *
 * // User-specified batch size takes precedence
 * calculateBatchSize(10, 250) // returns 250
 * ```
 */
export function calculateBatchSize(fieldCount: number, userBatchSize?: number): number {
  // If user explicitly specified a batch size, use it (but respect min/max bounds)
  if (userBatchSize !== undefined) {
    return Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, userBatchSize));
  }

  // Avoid division by zero
  if (fieldCount <= 0) {
    return MAX_BATCH_SIZE;
  }

  const dynamicSize = Math.floor(PG_PARAM_SAFE_LIMIT / fieldCount);
  return Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, dynamicSize));
}
