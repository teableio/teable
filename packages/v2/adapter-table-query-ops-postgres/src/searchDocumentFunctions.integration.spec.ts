import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureSearchDocumentFunctions } from './searchDocumentFunctions';
import type { UnknownPostgresDatabase } from './types';

const enabled = process.env.TEABLE_V2_RUN_SEARCH_VECTOR_PG_INTEGRATION === '1';
const databaseUrl = process.env.PRISMA_DATABASE_URL;
if (enabled && !databaseUrl) throw new Error('Postgres integration requires PRISMA_DATABASE_URL');

(enabled ? describe : describe.skip)('search document function installation', () => {
  let admin: Kysely<UnknownPostgresDatabase>;
  let db: Kysely<UnknownPostgresDatabase>;
  const databaseName = `search_function_test_${process.pid}_${Date.now()}`;
  const projections = [{ kind: 'rounded_number_list', precision: 2 }] as const;

  beforeAll(async () => {
    admin = await createV2PostgresDb({ pg: { connectionString: databaseUrl! } });
    await sql.raw(`CREATE DATABASE "${databaseName}"`).execute(admin);
    const isolatedUrl = new URL(databaseUrl!);
    isolatedUrl.pathname = `/${databaseName}`;
    db = await createV2PostgresDb({ pg: { connectionString: isolatedUrl.toString() } });
  });

  afterAll(async () => {
    await db?.destroy();
    if (admin) {
      await sql.raw(`DROP DATABASE IF EXISTS "${databaseName}"`).execute(admin);
      await admin.destroy();
    }
  });

  it('skips unneeded helpers, creates once under concurrent calls, and preserves its identity', async () => {
    await ensureSearchDocumentFunctions(db, [{ kind: 'plain' }]);
    const before = await sql<{
      present: boolean;
    }>`SELECT to_regprocedure('public.teable_search_rounded_number_list_v1(jsonb,integer)') IS NOT NULL AS present`.execute(
      db
    );
    expect(before.rows[0].present).toBe(false);
    await Promise.all([
      ensureSearchDocumentFunctions(db, projections),
      ensureSearchDocumentFunctions(db, projections),
    ]);
    const original =
      await sql`SELECT oid, prosrc FROM pg_proc WHERE oid = 'public.teable_search_rounded_number_list_v1(jsonb,integer)'::regprocedure`.execute(
        db
      );
    await ensureSearchDocumentFunctions(db, projections);
    const repeated =
      await sql`SELECT oid, prosrc FROM pg_proc WHERE oid = 'public.teable_search_rounded_number_list_v1(jsonb,integer)'::regprocedure`.execute(
        db
      );
    expect(repeated.rows).toEqual(original.rows);
    await sql
      .raw(
        `CREATE TABLE numbers (cell jsonb, document text GENERATED ALWAYS AS (public.teable_search_rounded_number_list_v1(cell, 2)) STORED)`
      )
      .execute(db);
    await sql.raw(`INSERT INTO numbers(cell) VALUES ('[1.234, null, -2.345]'::jsonb)`).execute(db);
    expect((await sql`SELECT document FROM numbers`.execute(db)).rows).toEqual([
      { document: '1.23, -2.35' },
    ]);
    await sql.raw('DROP TABLE numbers').execute(db);
  });

  it('rejects a colliding immutable function without replacing it', async () => {
    await sql
      .raw('DROP FUNCTION public.teable_search_rounded_number_list_v1(jsonb, integer)')
      .execute(db);
    await sql
      .raw(
        `CREATE FUNCTION public.teable_search_rounded_number_list_v1(cell jsonb, precision_digits integer) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT ''collision''::text'`
      )
      .execute(db);
    await expect(ensureSearchDocumentFunctions(db, projections)).rejects.toThrow(
      'definition collision'
    );
    expect(
      (
        await sql`SELECT public.teable_search_rounded_number_list_v1('[]'::jsonb, 2) AS value`.execute(
          db
        )
      ).rows
    ).toEqual([{ value: 'collision' }]);
  });
});
