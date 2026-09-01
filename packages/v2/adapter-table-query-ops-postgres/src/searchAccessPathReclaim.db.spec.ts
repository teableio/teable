/* eslint-disable @typescript-eslint/naming-convention */
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureTableQueryObservationSchema,
  ensureTableQueryOpsSchema,
  type TableQueryObservationDatabase,
  type TableQueryOpsDatabase,
} from './schema';
import { PostgresTableSearchAccessPathReclaimSource } from './searchAccessPathReclaim';
import type { UnknownPostgresDatabase } from './types';

const runPostgresAcceptance = process.env.TEABLE_V2_RUN_RECLAIM_PG_INTEGRATION === '1';
const testDatabaseUrl = process.env.PRISMA_DATABASE_URL;
if (runPostgresAcceptance && !testDatabaseUrl) {
  throw new Error('TEABLE_V2_RUN_RECLAIM_PG_INTEGRATION=1 requires PRISMA_DATABASE_URL');
}
const describeWithPostgres = runPostgresAcceptance ? describe : describe.skip;

describeWithPostgres('PostgresTableSearchAccessPathReclaimSource', () => {
  const suffix = String(process.pid);
  const tableId = `tbl_reclaim_${suffix}`;
  const baseId = `bse_reclaim_${suffix}`;
  const candidateKey = `search:all:${suffix}`;
  const physicalTable = `tqops_reclaim_${suffix}`;
  const indexName = `tqops_reclaim_idx_${suffix}`;
  const now = new Date('2026-08-22T00:00:00.000Z');
  let db: Kysely<TableQueryOpsDatabase>;

  beforeAll(async () => {
    db = await createV2PostgresDb<TableQueryOpsDatabase>({
      pg: { connectionString: testDatabaseUrl!, pool: { max: 1, allowExitOnIdle: true } },
    });
    await ensureTableQueryOpsSchema(db);
    await ensureTableQueryObservationSchema(db as unknown as Kysely<TableQueryObservationDatabase>);
    await sql.raw(`CREATE TABLE "${physicalTable}" (id integer)`).execute(db);
    await sql.raw(`CREATE INDEX "${indexName}" ON "${physicalTable}" (id)`).execute(db);
    await sql`
      INSERT INTO table_query_observation_shard (
        base_id, table_id, query_kind, shape_hash, window_start, writer_id,
        window_size_seconds, request_count, slow_count, timeout_count,
        db_error_count, total_duration_ms, max_duration_ms, shape
      ) VALUES (
        ${baseId}, ${tableId}, 'search', 'shape',
        ${new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000)}, 'reclaim-test',
        300, 1, 0, 0, 0, 1, 1, ${JSON.stringify({})}::jsonb
      )
    `.execute(db);
    await sql`
      INSERT INTO table_query_search_vector_config (
        id, base_id, table_id, candidate_key, generated_column_name, index_name,
        field_ids, field_db_names, status, reclaim_idx_scan_baseline,
        reclaim_sampled_at, created_time, last_modified_time
      ) VALUES (
        ${`tqsv_reclaim_${suffix}`}, ${baseId}, ${tableId}, ${candidateKey},
        '__tqops_search_doc_test', ${indexName}, '[]'::jsonb, '[]'::jsonb,
        'ready', 0, ${new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000)},
        ${new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)},
        ${new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)}
      )
    `.execute(db);
  });

  afterAll(async () => {
    await sql`DELETE FROM table_query_observation_shard WHERE table_id = ${tableId}`.execute(db);
    await sql`DELETE FROM table_query_search_vector_config WHERE table_id = ${tableId}`.execute(db);
    await sql.raw(`DROP TABLE IF EXISTS "${physicalTable}"`).execute(db);
    await db?.destroy();
  });

  it('returns the refreshed row version so eligible evidence can begin grace', async () => {
    const source = new PostgresTableSearchAccessPathReclaimSource(
      db,
      db as unknown as Kysely<TableQueryObservationDatabase>,
      db as unknown as Kysely<UnknownPostgresDatabase>
    );

    const candidates = await source.listCandidates({} as never, {
      now,
      minHoldMs: 30 * 24 * 60 * 60 * 1000,
      idleMs: 30 * 24 * 60 * 60 * 1000,
    });
    const candidate = candidates._unsafeUnwrap().find((item) => item.tableId === tableId);

    expect(candidate).toMatchObject({ phase: 'active', indexScanDelta: 0 });
    const beganGrace = await source.beginGrace({} as never, {
      tableId,
      scopeKey: candidate!.scopeKey,
      expectedVersion: candidate!.configVersion,
      disabledAt: now,
      dropAfter: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    expect(beganGrace._unsafeUnwrap()).toBe(true);
  });
});
