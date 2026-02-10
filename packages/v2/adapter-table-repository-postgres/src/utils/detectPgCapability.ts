import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Detects whether the connected PostgreSQL database supports `pg_input_is_valid`.
 *
 * This function is more reliable than parsing `version()` as it:
 * - Works with pglite, cloud database variants, etc.
 * - Directly tests the capability rather than inferring from version
 *
 * Only returns false for "function does not exist" errors (PG error code 42883).
 * Other errors (connection, permission, etc.) are re-thrown.
 */
export async function hasPgInputIsValid<DB>(db: Kysely<DB>): Promise<boolean> {
  try {
    await sql`SELECT pg_input_is_valid('1', 'numeric')`.execute(db);
    return true;
  } catch (error) {
    // Only return false for "function does not exist" errors
    // Other errors (connection, permission, etc.) should be re-thrown
    if (isPgUndefinedFunctionError(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Asserts that the `public.teable_try_cast_valid` polyfill exists and is callable.
 *
 * This project installs the polyfill via Prisma migrations (see
 * `packages/db-main-prisma/prisma/postgres/migrations/*_add_teable_try_cast_valid`).
 * Keeping this check side-effect free avoids requiring DDL privileges at runtime.
 */
export async function assertTypeValidationPolyfill<DB>(db: Kysely<DB>): Promise<void> {
  try {
    await sql`SELECT public.teable_try_cast_valid('1', 'numeric')`.execute(db);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to call public.teable_try_cast_valid';
    throw new Error(
      `Missing PostgreSQL type validation polyfill (public.teable_try_cast_valid). ` +
        `Run DB migrations before starting the app. Root error: ${message}`
    );
  }
}

/**
 * Checks if the error is a "function does not exist" error.
 * PostgreSQL error code: 42883 (undefined_function)
 */
function isPgUndefinedFunctionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  // Kysely/pg puts PG error codes in error.code
  const pgError = error as { code?: string; message?: string };

  // Method 1: Check PG error code
  if (pgError.code === '42883') return true;

  // Method 2: Check error message (fallback across drivers)
  const message = pgError.message?.toLowerCase() ?? '';
  if (!message.includes('pg_input_is_valid')) return false;
  if (message.includes('does not exist')) return true;
  if (message.includes('no such function')) return true;
  if (message.includes('undefined function')) return true;

  return false;
}
