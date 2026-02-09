/**
 * PostgreSQL type validation types supported by the strategy.
 */
export type PgValidationType = 'timestamptz' | 'timestamp' | 'numeric' | 'jsonb';

/**
 * Strategy interface for PostgreSQL type validation.
 *
 * This interface allows different implementations for different PostgreSQL versions:
 * - PG 16+: Uses native `pg_input_is_valid` function
 * - PG < 16: Uses polyfill function `public.teable_try_cast_valid`
 *
 * Note: trim/sanitize/normalize logic is handled in the builder layer,
 * ensuring consistent semantics between PG15 and PG16.
 */
export interface IPgTypeValidationStrategy {
  /**
   * Returns a SQL expression that evaluates to TRUE if valueSql can be safely cast to the target type.
   *
   * @param valueSql - SQL expression representing the value to validate (should already be ::text format)
   * @param typeName - Target PostgreSQL type to validate against
   * @returns SQL string expression that evaluates to a boolean
   */
  isValidForType(valueSql: string, typeName: PgValidationType): string;
}
