import { sql, type Kysely } from 'kysely';

import { undoCaptureGlobalStatements } from './undoCaptureGlobalsSql';

/**
 * Installs the migration-owned undo capture globals into an ephemeral database.
 * Test/bootstrap code uses this helper because those databases do not run the
 * normal Prisma migration pipeline before exercising record mutations.
 */
export const installUndoCaptureGlobals = async (db: Kysely<unknown>) => {
  for (const statement of undoCaptureGlobalStatements) {
    await sql.raw(statement).execute(db);
  }
};
