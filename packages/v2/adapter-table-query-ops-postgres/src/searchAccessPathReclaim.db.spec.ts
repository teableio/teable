/* eslint-disable @typescript-eslint/naming-convention */
import { randomUUID } from 'node:crypto';
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import type { DomainError } from '@teable/v2-core';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Result } from 'neverthrow';
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
  const schema = `reclaim_${randomUUID().replaceAll('-', '')}`;
  let admin: Kysely<TableQueryOpsDatabase>;
  let db: Kysely<TableQueryOpsDatabase>;

  beforeAll(async () => {
    admin = await createV2PostgresDb<TableQueryOpsDatabase>({
      pg: { connectionString: testDatabaseUrl!, pool: { max: 1, allowExitOnIdle: true } },
    });
    await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(admin);
    const url = new URL(testDatabaseUrl!);
    url.searchParams.set(
      'options',
      `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=5000`
    );
    db = await createV2PostgresDb<TableQueryOpsDatabase>({
      pg: { connectionString: url.toString(), pool: { max: 3, allowExitOnIdle: true } },
    });
    await ensureTableQueryOpsSchema(db);
    await ensureTableQueryObservationSchema(db as unknown as Kysely<TableQueryObservationDatabase>);
    await sql`
      CREATE TABLE table_meta (
        id text PRIMARY KEY, version integer NOT NULL, search_index jsonb
      )
    `.execute(db);
    await sql`
      INSERT INTO table_meta (id, version, search_index)
      VALUES (${tableId}, 1, ${JSON.stringify({ definitionKey: candidateKey })}::jsonb)
    `.execute(db);
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
    await db?.destroy();
    if (admin) {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(schema)} CASCADE`.execute(admin);
      await admin.destroy();
    }
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
    const stale = await source.beginGrace({} as never, {
      tableId,
      scopeKey: candidate!.scopeKey,
      expectedVersion: '0',
      disabledAt: now,
      dropAfter: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    expect(stale._unsafeUnwrap()).toBe(false);
    expect(
      (await sql`SELECT version, search_index FROM table_meta WHERE id = ${tableId}`.execute(db))
        .rows
    ).toEqual([{ version: 1, search_index: { definitionKey: candidateKey } }]);
    const beganGrace = await source.beginGrace({} as never, {
      tableId,
      scopeKey: candidate!.scopeKey,
      expectedVersion: candidate!.configVersion,
      disabledAt: now,
      dropAfter: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    expect(beganGrace._unsafeUnwrap()).toBe(true);
    expect(
      (await sql`SELECT version, search_index FROM table_meta WHERE id = ${tableId}`.execute(db))
        .rows
    ).toEqual([{ version: 2, search_index: null }]);
    const retainedIndex = await sql<{ exists: boolean }>`
      SELECT to_regclass(${indexName}) IS NOT NULL AS exists
    `.execute(db);
    expect(retainedIndex.rows[0]?.exists).toBe(true);
  });

  it.each([
    { writer: 'table-meta-first writer', advisoryLock: false },
    { writer: 'publication holding the search-vector advisory lock', advisoryLock: true },
  ])('preserves refreshed metadata when grace contends with $writer', async ({ advisoryLock }) => {
    const source = new PostgresTableSearchAccessPathReclaimSource(
      db,
      db as unknown as Kysely<TableQueryObservationDatabase>,
      db as unknown as Kysely<UnknownPostgresDatabase>
    );
    await sql`
      UPDATE table_meta
      SET version = 1, search_index = ${JSON.stringify({ definitionKey: candidateKey })}::jsonb
      WHERE id = ${tableId}
    `.execute(db);
    const config = await sql<{ config_version: string }>`
      UPDATE table_query_search_vector_config
      SET status = 'ready', reclaim_disabled_at = NULL, reclaim_drop_after = NULL,
          reclaim_drop_queued_at = NULL
      WHERE table_id = ${tableId}
      RETURNING xmin::text AS config_version
    `.execute(db);
    const refreshedSnapshot = { definitionKey: candidateKey, indexName };
    let grace: Promise<Result<boolean, DomainError>> | undefined;

    try {
      await db.transaction().execute(async (writer) => {
        if (advisoryLock) {
          await sql`
            SELECT pg_advisory_xact_lock(
              hashtext('teable.table_query_ops.search_vector'), hashtext(${tableId})
            )
          `.execute(writer);
        }
        await sql`SELECT id FROM table_meta WHERE id = ${tableId} FOR UPDATE`.execute(writer);
        const writerPid = (
          await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(writer)
        ).rows[0]!.pid;
        grace = source.beginGrace({} as never, {
          tableId,
          scopeKey: candidateKey,
          expectedVersion: config.rows[0]!.config_version,
          disabledAt: now,
          dropAfter: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        });

        // Observe the actual blocked backend before taking the second row lock.
        // The old config-first CTE now deadlocks against this table-first writer.
        await expect
          .poll(
            async () => {
              const blocked = await sql<{ blocked: boolean }>`
                SELECT EXISTS (
                  SELECT 1 FROM pg_stat_activity
                  WHERE datname = current_database()
                    AND ${writerPid} = ANY(pg_blocking_pids(pid))
                ) AS blocked
              `.execute(db);
              return blocked.rows[0]!.blocked;
            },
            { interval: 10, timeout: 4000 }
          )
          .toBe(true);

        await sql`
          UPDATE table_query_search_vector_config
          SET last_modified_time = ${now}
          WHERE table_id = ${tableId}
        `.execute(writer);
        await sql`
          UPDATE table_meta
          SET search_index = ${JSON.stringify(refreshedSnapshot)}::jsonb, version = version + 1
          WHERE id = ${tableId}
        `.execute(writer);
      });

      expect((await grace)!._unsafeUnwrap()).toBe(false);
      expect(
        (await sql`SELECT version, search_index FROM table_meta WHERE id = ${tableId}`.execute(db))
          .rows
      ).toEqual([{ version: 2, search_index: refreshedSnapshot }]);
      expect(
        (
          await sql`
            SELECT status, reclaim_disabled_at, reclaim_drop_after, reclaim_drop_queued_at
            FROM table_query_search_vector_config WHERE table_id = ${tableId}
          `.execute(db)
        ).rows
      ).toEqual([
        {
          status: 'ready',
          reclaim_disabled_at: null,
          reclaim_drop_after: null,
          reclaim_drop_queued_at: null,
        },
      ]);
    } finally {
      // Drain grace after the writer commits or rolls back, including assertion failures.
      await grace;
    }
  });
});
