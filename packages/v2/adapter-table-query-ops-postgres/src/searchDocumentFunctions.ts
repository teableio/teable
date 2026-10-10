import type { SearchFieldTextProjection } from '@teable/v2-core';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import {
  requiresRoundedNumberListSearchFunction,
  roundedNumberListSearchFunctionBody,
  roundedNumberListSearchFunctionSql,
} from './searchDocumentProjection';
import type { UnknownPostgresDatabase } from './types';

/** Called only after the caller's writable-maintenance guards. Never replace
 * an existing helper: stored generated values would otherwise silently drift. */
export const ensureSearchDocumentFunctions = async (
  db: Kysely<UnknownPostgresDatabase>,
  projections: ReadonlyArray<SearchFieldTextProjection | undefined>
): Promise<void> => {
  if (!requiresRoundedNumberListSearchFunction(projections)) return;

  const readDefinition = async () => {
    const result = await sql<{ matches: boolean }>`
      SELECT (
        p.prosrc = ${roundedNumberListSearchFunctionBody}
        AND p.provolatile = 'i' AND p.proparallel = 's'
        AND p.prorettype = 'pg_catalog.text'::regtype
        AND p.prokind = 'f' AND NOT p.proretset AND NOT p.prosecdef
        AND NOT p.proisstrict AND p.prosqlbody IS NULL
        AND p.proargnames = ARRAY['cell', 'precision_digits']::text[]
        AND p.proconfig = ARRAY['search_path=pg_catalog']::text[]
        AND l.lanname = 'sql'
      ) AS matches
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE p.oid = pg_catalog.to_regprocedure(
        'public.teable_search_rounded_number_list_v1(jsonb,integer)'
      )
    `.execute(db);
    return result.rows[0];
  };

  const existing = await readDefinition();
  if (!existing) {
    // The exception block gives CREATE a savepoint even if the caller uses a
    // transaction; a concurrent installation must not abort that transaction.
    await sql
      .raw(
        `DO $teable_install$
        BEGIN
          ${roundedNumberListSearchFunctionSql};
        EXCEPTION WHEN duplicate_function OR unique_violation THEN NULL;
        END
      $teable_install$`
      )
      .execute(db);
  }
  const definition = existing ?? (await readDefinition());
  if (definition?.matches !== true) {
    throw new Error('Search document numeric-list helper definition collision');
  }
};
