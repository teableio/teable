import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { KyselyPGlite } from '../../../../packages/v2/adapter-db-postgres-pglite/src/kyselyPgliteBrowser';
import {
  assembleComputedOutboxBasePendingCapacityPage,
  buildComputedOutboxBasePendingCapacityQuery,
} from './computed-outbox-maintenance-query';
import type { IComputedOutboxMaintenanceTarget } from './data-db-client-manager.service';

/**
 * Executes the generated `?`-placeholder SQL the way the knex-backed manager
 * does: positional placeholders become `$n` in the same order.
 */
const positionSql = (sql: string, bindings: ReadonlyArray<unknown>) => {
  let next = 0;
  const text = sql.replaceAll('?', () => `$${(next += 1)}`);
  return { text, parameters: [...bindings] };
};

const schema = `computed_capacity_${randomUUID().replaceAll('-', '')}`;
const byodbSchema = `computed_capacity_byodb_${randomUUID().replaceAll('-', '')}`;
const spaceId = 'spc-main';

async function createLedgerTables(
  exec: (sql: string) => Promise<unknown>,
  schemaName: string
): Promise<void> {
  await exec(`create schema ${schemaName}`);
  await exec(`set search_path to ${schemaName}`);
  await exec(`create table "base" (id text primary key, space_id text)`);
  await exec(`create table space_data_db_binding (space_id text, mode text)`);
  await exec(
    `create table computed_update_pause_scope (
       id text primary key,
       scope_type text not null,
       scope_id text not null,
       resume_at timestamptz,
       created_at timestamptz not null default now()
     )`
  );
  await exec(
    `create table computed_update_outbox (
       id text primary key,
       base_id text not null,
       seed_table_id text not null,
       affected_table_ids text[],
       status text not null,
       next_run_at timestamptz not null default now(),
       created_at timestamptz not null default now(),
       updated_at timestamptz not null default now(),
       worker_lane text
     )`
  );
  await exec(
    `create table computed_update_dead_letter (
       id text primary key,
       base_id text,
       seed_table_id text,
       last_error text,
       failed_at timestamptz not null default now()
     )`
  );
}

async function insertBases(
  client: KyselyPGlite['client'],
  baseIds: ReadonlyArray<string>
): Promise<void> {
  for (const baseId of baseIds) {
    await client.query(`insert into "base" (id, space_id) values ($1, $2)`, [baseId, spaceId]);
  }
  // Default storage only routes bases whose space is not bound to BYODB.
  await client.query(`insert into space_data_db_binding (space_id, mode) values ($1, 'default')`, [
    spaceId,
  ]);
}

type PendingOptions = {
  status?: string;
  prefix?: string;
  seedTableId?: string;
  /** Schedules the row into the future instead of making it immediately due. */
  scheduled?: boolean;
};

async function insertPending(
  client: KyselyPGlite['client'],
  baseId: string,
  count: number,
  options: PendingOptions = {}
): Promise<void> {
  const status = options.status ?? 'pending';
  const prefix = options.prefix ?? 'task';
  const seedTableId = options.seedTableId ?? 'tbl-seed';
  const nextRunAt = options.scheduled ? `now() + interval '1 hour'` : 'now()';
  for (let index = 0; index < count; index += 1) {
    await client.query(
      `insert into computed_update_outbox
         (id, base_id, seed_table_id, affected_table_ids, status, next_run_at)
       values ($1, $2, $3, array[$3]::text[], $4, ${nextRunAt})`,
      [`${prefix}-${baseId}-${index}`, baseId, seedTableId, status]
    );
  }
}

/**
 * Shared fixture for the paging/count tests. Each test seeds it explicitly after
 * `beforeEach` truncates both schemas, so no test depends on another's rows.
 */
async function seedCapacityFixture(
  client: KyselyPGlite['client'],
  schemaName: string
): Promise<void> {
  await client.exec(`set search_path to ${schemaName}`);
  await insertBases(client, [
    'bse-at',
    'bse-below',
    'bse-cold',
    'bse-dead',
    'bse-paused',
    'bse-processing',
    'bse-sched',
  ]);

  await insertPending(client, 'bse-at', 10);
  await insertPending(client, 'bse-below', 9);
  await insertPending(client, 'bse-cold', 2);
  // Five due + five future-dated rows: capacity is the ten, not just the due five.
  await insertPending(client, 'bse-sched', 5);
  await insertPending(client, 'bse-sched', 5, { prefix: 'sched', scheduled: true });
  // Ten actionable rows on one seed table plus ten blocked by a table-scope pause:
  // the paused ten must not count, so this base reports exactly ten.
  await insertPending(client, 'bse-paused', 10);
  await insertPending(client, 'bse-paused', 10, {
    prefix: 'parked',
    seedTableId: 'tbl-paused',
  });
  await client.query(
    `insert into computed_update_pause_scope (id, scope_type, scope_id, resume_at)
     values ('scope-paused', 'table', 'tbl-paused', null)`
  );
  await insertPending(client, 'bse-processing', 10, { status: 'processing' });
  await client.query(
    `insert into computed_update_dead_letter (id, base_id, seed_table_id, last_error)
     values ('dead-1', 'bse-dead', 'tbl-seed', 'boom')`
  );
}

describe('computed outbox per-base pending capacity (real SQL)', () => {
  let client: KyselyPGlite['client'];

  beforeAll(async () => {
    const created = await KyselyPGlite.create('memory://');
    client = created.client;
    await createLedgerTables((sql) => client.exec(sql), schema);
    await createLedgerTables((sql) => client.exec(sql), byodbSchema);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    // Independent fixtures: no test may rely on rows another test inserted.
    for (const schemaName of [schema, byodbSchema]) {
      await client.exec(
        `truncate table ${schemaName}."base", ${schemaName}.space_data_db_binding,
           ${schemaName}.computed_update_pause_scope, ${schemaName}.computed_update_outbox,
           ${schemaName}.computed_update_dead_letter`
      );
    }
  });

  const target: IComputedOutboxMaintenanceTarget = {
    cacheKey: 'default',
    url: 'postgresql://pglite/default',
    isMetaFallback: true,
    storage: 'default',
  };

  const runPage = async (
    selected: IComputedOutboxMaintenanceTarget,
    request: { threshold: number; limit: number; afterBaseId?: string }
  ) => {
    const query = buildComputedOutboxBasePendingCapacityQuery(selected, request);
    const positioned = positionSql(query.sql, query.bindings);
    const result = await client.query<{ baseId: string; pending: number | string }>(
      positioned.text,
      positioned.parameters
    );
    const rows = result.rows.map((row) => ({
      baseId: row.baseId,
      pending: Number(row.pending),
    }));
    return {
      page: assembleComputedOutboxBasePendingCapacityPage(rows, request),
    };
  };

  it('counts due and scheduled pending capacity while excluding paused, processing and dead work', async () => {
    await seedCapacityFixture(client, schema);
    const atThreshold = await runPage(target, { threshold: 10, limit: 50 });

    expect(atThreshold.page.bases).toEqual([
      { baseId: 'bse-at', pending: 10 },
      { baseId: 'bse-paused', pending: 10 },
      { baseId: 'bse-sched', pending: 10 },
    ]);
    expect(atThreshold.page.scannedToEnd).toBe(true);
    expect(atThreshold.page.scannedThroughBaseId).toBe('bse-sched');
    for (const absent of ['bse-below', 'bse-cold', 'bse-dead', 'bse-processing']) {
      expect(atThreshold.page.bases.map((item) => item.baseId)).not.toContain(absent);
    }

    // Exact boundary: threshold-1 stays silent, threshold fires.
    expect((await runPage(target, { threshold: 11, limit: 50 })).page.bases).toEqual([]);
  });

  it('pages by base id so the (N+1)th over-threshold base is reachable', async () => {
    await seedCapacityFixture(client, schema);

    const first = await runPage(target, { threshold: 9, limit: 2 });
    expect(first.page.bases).toEqual([
      { baseId: 'bse-at', pending: 10 },
      { baseId: 'bse-below', pending: 9 },
    ]);
    expect(first.page.truncated).toBe(true);
    expect(first.page.scannedToEnd).toBe(false);
    expect(first.page.nextBaseId).toBe('bse-below');
    expect(first.page.limit).toBe(2);

    const second = await runPage(target, {
      threshold: 9,
      limit: 2,
      afterBaseId: first.page.nextBaseId,
    });
    expect(second.page.bases).toEqual([
      { baseId: 'bse-paused', pending: 10 },
      { baseId: 'bse-sched', pending: 10 },
    ]);
    expect(second.page.scannedToEnd).toBe(true);
    expect(second.page.afterBaseId).toBe('bse-below');
    expect(second.page.nextBaseId).toBeUndefined();
  });

  it('normalizes an oversized limit before the sentinel slice', () => {
    const rows = Array.from({ length: 1002 }, (_, index) => ({
      baseId: `bse-${String(index).padStart(4, '0')}`,
      pending: 10,
    }));

    const page = assembleComputedOutboxBasePendingCapacityPage(rows, {
      threshold: 10,
      limit: 5000,
    });

    expect(page.limit).toBe(1000);
    expect(page.bases).toHaveLength(1000);
    expect(page.truncated).toBe(true);
    expect(page.nextBaseId).toBe('bse-0999');
  });

  it('routes BYODB targets through the supplied base mapping only', async () => {
    await client.exec(`set search_path to ${byodbSchema}`);
    await client.query(`insert into computed_update_outbox
        (id, base_id, seed_table_id, affected_table_ids, status, next_run_at)
      values
        ('b1', 'bse-mapped', 'tbl-seed', array['tbl-seed']::text[], 'pending', now()),
        ('b2', 'bse-mapped', 'tbl-seed', array['tbl-seed']::text[], 'pending', now()),
        ('b3', 'bse-unmapped', 'tbl-seed', array['tbl-seed']::text[], 'pending', now()),
        ('b4', 'bse-unmapped', 'tbl-seed', array['tbl-seed']::text[], 'pending', now())`);

    const byodbTarget: IComputedOutboxMaintenanceTarget = {
      cacheKey: 'byodb',
      url: 'postgresql://pglite/byodb',
      internalSchema: byodbSchema,
      isMetaFallback: false,
      storage: 'byodb',
      baseSpaceMapping: [{ baseId: 'bse-mapped', spaceId }],
    };

    const result = await runPage(byodbTarget, { threshold: 2, limit: 50 });

    expect(result.page.bases).toEqual([{ baseId: 'bse-mapped', pending: 2 }]);
    expect(result.page.bases.map((item) => item.baseId)).not.toContain('bse-unmapped');
  });
});
