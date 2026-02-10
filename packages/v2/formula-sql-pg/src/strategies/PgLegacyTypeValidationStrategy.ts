import type { IPgTypeValidationStrategy, PgValidationType } from '../PgTypeValidationStrategy';

/**
 * PostgreSQL < 16 type validation strategy (legacy).
 *
 * Uses a polyfill function `public.teable_try_cast_valid` to validate types.
 * This function must be created in the database via migration.
 *
 * Why not use regex:
 * - '2024-13-99' would match an ISO 8601 regex but ::timestamptz would throw an error
 * - '1e308' might match some numeric regex but would overflow during conversion
 * - Regex can only serve as a pre-filter optimization, not as the final validity check
 *
 * All types use the polyfill to ensure semantic equivalence with `pg_input_is_valid`.
 */
export class PgLegacyTypeValidationStrategy implements IPgTypeValidationStrategy {
  isValidForType(valueSql: string, typeName: PgValidationType): string {
    // All types use the polyfill function to guarantee semantic equivalence
    return `public.teable_try_cast_valid(${valueSql}, '${typeName}')`;
  }
}
