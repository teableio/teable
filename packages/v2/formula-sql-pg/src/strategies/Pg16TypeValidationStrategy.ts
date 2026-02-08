import type { IPgTypeValidationStrategy, PgValidationType } from '../PgTypeValidationStrategy';

/**
 * PostgreSQL 16+ type validation strategy.
 *
 * Uses the native `pg_input_is_valid` function introduced in PostgreSQL 16.
 * This function returns TRUE if the input can be safely cast to the specified type.
 */
export class Pg16TypeValidationStrategy implements IPgTypeValidationStrategy {
  isValidForType(valueSql: string, typeName: PgValidationType): string {
    return `pg_input_is_valid(${valueSql}, '${typeName}')`;
  }
}
