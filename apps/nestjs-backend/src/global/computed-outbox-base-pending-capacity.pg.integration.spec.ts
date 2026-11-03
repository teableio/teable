import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assembleComputedOutboxBasePendingCapacityPage,
  buildComputedOutboxBasePendingCapacityQuery,
} from './computed-outbox-maintenance-query';
import type { IComputedOutboxMaintenanceTarget } from './data-db-client-manager.service';

// Opt-in real PostgreSQL coverage. The monitor compares base ids with JS string
// operators (UTF-16 code units), so the SQL page order and cursor membership must
// use C collation even when the column uses a locale or ICU collation.
const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;
const connectionString =
  process.env.TEABLE_V2_TEST_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL;
const schema = `computed_capacity_${randomUUID().replaceAll('-', '')}`;
const baseIds = [
  `bse${'A'.repeat(16)}`,
  `bse${'B'.repeat(16)}`,
  `bse${'Z'.repeat(16)}`,
  `bse${'a'.repeat(16)}`,
];
const byteOrder = [...baseIds].sort();

const quoteCollation = (name: string) => `"${name.replaceAll('"', '""')}"`;

const positionSql = (sql: string, bindings: ReadonlyArray<unknown>) => {
  let next = 0;
  return {
    text: sql.replaceAll('?', () => `$${(next += 1)}`),
    parameters: [...bindings],
  };
};

describePg('computed outbox base capacity paging collation (PostgreSQL)', () => {
  let pool: Pool;
  let client: PoolClient;
  let collation: string;

  const orderedIds = async (name: string): Promise<string[]> => {
    const result = await client.query<{ id: string }>(
      `select id from unnest($1::text[]) as id order by id collate ${quoteCollation(name)}`,
      [baseIds]
    );
    return result.rows.map((row) => row.id);
  };

  beforeAll(async () => {
    if (!connectionString) {
      throw new Error(
        'Set TEABLE_V2_TEST_DATABASE_URL, PRISMA_DATABASE_URL or DATABASE_URL for the opt-in PostgreSQL test'
      );
    }
    pool = new Pool({ connectionString, max: 1 });
    client = await pool.connect();
    // Inspect the server's catalog instead of assuming ICU or a named locale.
    const candidates = await client.query<{ collname: string; collprovider: string }>(
      `select collname, collprovider from pg_collation
       where collname in ('en-US-x-icu', 'en_US.utf8', 'en_GB.utf8', 'und-x-icu')
       order by array_position(
         array['en-US-x-icu', 'en_US.utf8', 'en_GB.utf8', 'und-x-icu'],
         collname
       )`
    );
    for (const candidate of candidates.rows) {
      const order = await orderedIds(candidate.collname);
      if (order.join(',') !== byteOrder.join(',')) {
        collation = candidate.collname;
        break;
      }
    }
    if (!collation) {
      throw new Error('No available non-C collation orders the mixed-case fixture differently');
    }

    await client.query(`create schema ${schema}`);
    await client.query(`set search_path to ${schema}`);
    await client.query(`create table "base" (id text primary key, space_id text)`);
    await client.query(`create table space_data_db_binding (space_id text, mode text)`);
    await client.query(
      `create table computed_update_pause_scope (
         id text primary key,
         scope_type text not null,
         scope_id text not null,
         resume_at timestamptz
       )`
    );
    await client.query(
      `create table computed_update_outbox (
         id text primary key,
         base_id text collate ${quoteCollation(collation)} not null,
         seed_table_id text not null,
         affected_table_ids text[],
         status text not null,
         next_run_at timestamptz not null default now()
       )`
    );
    await client.query(
      `insert into space_data_db_binding (space_id, mode) values ('spc-main', 'default')`
    );
    for (const [index, baseId] of baseIds.entries()) {
      await client.query(`insert into "base" (id, space_id) values ($1, 'spc-main')`, [baseId]);
      await client.query(
        `insert into computed_update_outbox
           (id, base_id, seed_table_id, affected_table_ids, status)
         values ($1, $2, 'tbl-seed', array['tbl-seed']::text[], 'pending'),
                ($3, $2, 'tbl-seed', array['tbl-seed']::text[], 'pending')`,
        [`first-${index}`, baseId, `second-${index}`]
      );
    }
  });

  afterAll(async () => {
    if (client) {
      await client.query(`drop schema if exists ${schema} cascade`);
      client.release();
    }
    if (pool) await pool.end();
  });

  const target: IComputedOutboxMaintenanceTarget = {
    cacheKey: 'default',
    url: 'postgresql://isolated/default',
    isMetaFallback: true,
    storage: 'default',
  };

  const runPage = async (afterBaseId?: string) => {
    const request = { threshold: 2, limit: 2, afterBaseId };
    const query = buildComputedOutboxBasePendingCapacityQuery(target, request);
    const positioned = positionSql(query.sql, query.bindings);
    const result = await client.query<{ baseId: string; pending: number | string }>(
      positioned.text,
      positioned.parameters
    );
    return assembleComputedOutboxBasePendingCapacityPage(
      result.rows.map((row) => ({ baseId: row.baseId, pending: Number(row.pending) })),
      request
    );
  };

  it('pages mixed-case ids in the same byte order the monitor compares', async () => {
    expect(await orderedIds(collation)).not.toEqual(byteOrder);
    expect(await orderedIds('C')).toEqual(byteOrder);

    const first = await runPage();
    expect(first.bases).toEqual([
      { baseId: baseIds[0], pending: 2 },
      { baseId: baseIds[1], pending: 2 },
    ]);
    expect(first.truncated).toBe(true);
    expect(first.scannedToEnd).toBe(false);
    expect(first.nextBaseId).toBe(baseIds[1]);

    const second = await runPage(first.nextBaseId);
    expect(second.bases).toEqual([
      { baseId: baseIds[2], pending: 2 },
      { baseId: baseIds[3], pending: 2 },
    ]);
    expect(second.scannedToEnd).toBe(true);
    expect(second.nextBaseId).toBeUndefined();
  });

  it('keeps cursor membership exclusive in byte order', async () => {
    const afterFirst = await runPage(baseIds[0]);
    expect(afterFirst.bases.map((item) => item.baseId)).toEqual([baseIds[1], baseIds[2]]);
    expect(afterFirst.afterBaseId).toBe(baseIds[0]);
    expect(afterFirst.scannedToEnd).toBe(false);

    const afterThird = await runPage(baseIds[2]);
    expect(afterThird.bases).toEqual([{ baseId: baseIds[3], pending: 2 }]);
    expect(afterThird.scannedToEnd).toBe(true);

    // Nothing sorts after the highest byte-order id.
    const afterLast = await runPage(baseIds[3]);
    expect(afterLast.bases).toEqual([]);
    expect(afterLast.scannedToEnd).toBe(true);
  });
});
