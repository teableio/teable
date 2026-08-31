/**
 * Regression test for stage-output seed-group collection when the dirty temp
 * table does not exist.
 *
 * A staged continuation whose batch has no seed input (frontier fully retired,
 * no explicit seeds) skips execution entirely, so `pg_temp.tmp_computed_dirty`
 * is never created — yet stage settlement still collects the stage's outputs.
 * Collection must fall back to the durable ledger instead of failing with
 * `relation "pg_temp.tmp_computed_dirty" does not exist` (which dead-letters
 * the task as storage_missing).
 */
import { sql, type Kysely } from 'kysely';
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import type { DynamicDB } from '../../query-builder';
import { collectStageOutputSeedGroups, STAGE_LEDGER_TABLE } from '../ComputedStageLedger';

const DIRTY_TABLE = 'pg_temp.tmp_computed_dirty';
const SCOPE_ID = 'tsk_scope_test';
const TABLE_A = 'tblAAAAAAAAAAAAAA01';
const TABLE_B = 'tblBBBBBBBBBBBBBB02';

describe('collectStageOutputSeedGroups without the dirty temp table', () => {
  let pglite: Awaited<ReturnType<typeof createPGliteDb>>['pglite'];
  let db: Kysely<DynamicDB>;

  beforeAll(async () => {
    const created = await createPGliteDb();
    pglite = created.pglite;
    db = created.db as unknown as Kysely<DynamicDB>;
    await db.schema
      .createTable(STAGE_LEDGER_TABLE)
      .addColumn('scope_id', 'text', (col) => col.notNull())
      .addColumn('kind', 'text', (col) => col.notNull())
      .addColumn('table_id', 'text', (col) => col.notNull())
      .addColumn('record_id', 'text', (col) => col.notNull())
      .addColumn('seq', 'bigint', (col) => col.notNull().defaultTo(0))
      .addPrimaryKeyConstraint(`${STAGE_LEDGER_TABLE}_pkey`, [
        'scope_id',
        'kind',
        'table_id',
        'record_id',
      ])
      .execute();
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    await db.executeQuery(sql`drop table if exists ${sql.table(DIRTY_TABLE)}`.compile(db));
    await db.deleteFrom(STAGE_LEDGER_TABLE).execute();
  });

  const insertLedgerRows = async (
    rows: Array<{ kind: string; tableId: string; recordId: string }>
  ) => {
    await db
      .insertInto(STAGE_LEDGER_TABLE)
      .values(
        rows.map((row) => ({
          scope_id: SCOPE_ID,
          kind: row.kind,
          table_id: row.tableId,
          record_id: row.recordId,
        }))
      )
      .execute();
  };

  it('collects excluded ledger rows when the dirty temp table is absent', async () => {
    await insertLedgerRows([
      { kind: 'excluded', tableId: TABLE_A, recordId: 'recA1' },
      { kind: 'excluded', tableId: TABLE_A, recordId: 'recA2' },
      { kind: 'excluded', tableId: TABLE_B, recordId: 'recB1' },
    ]);

    const result = await collectStageOutputSeedGroups(db, SCOPE_ID, [TABLE_A, TABLE_B], {
      seedAllThreshold: 100,
      exactIdsTotalCap: 100,
    });

    expect(result.isOk()).toBe(true);
    const { groups, seedAllTableIds } = result._unsafeUnwrap();
    expect(seedAllTableIds).toEqual([]);
    const byTable = new Map(groups.map((group) => [group.tableId, [...group.recordIds].sort()]));
    expect(byTable.get(TABLE_A)).toEqual(['recA1', 'recA2']);
    expect(byTable.get(TABLE_B)).toEqual(['recB1']);
  });

  it('collects preserved consumed sources when the dirty temp table is absent', async () => {
    await insertLedgerRows([
      { kind: 'consumed', tableId: TABLE_A, recordId: 'recA1' },
      // Also excluded: the disjoint branches must not double-count it.
      { kind: 'consumed', tableId: TABLE_A, recordId: 'recA2' },
      { kind: 'excluded', tableId: TABLE_A, recordId: 'recA2' },
    ]);

    const result = await collectStageOutputSeedGroups(db, SCOPE_ID, [TABLE_A], {
      seedAllThreshold: 100,
      exactIdsTotalCap: 100,
      includeConsumedSources: true,
    });

    expect(result.isOk()).toBe(true);
    const { groups } = result._unsafeUnwrap();
    expect(groups).toHaveLength(1);
    expect([...groups[0].recordIds].sort()).toEqual(['recA1', 'recA2']);
  });

  it('returns empty seed groups when both the temp table and the ledger are empty', async () => {
    const result = await collectStageOutputSeedGroups(db, SCOPE_ID, [TABLE_A], {
      seedAllThreshold: 100,
      exactIdsTotalCap: 100,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ groups: [], seedAllTableIds: [] });
  });

  it('still unions the dirty temp table with the ledger when it exists', async () => {
    await db.executeQuery(
      sql`create temporary table ${sql.table(DIRTY_TABLE)} (
        table_id text not null,
        record_id text not null,
        generation integer not null default 0,
        primary key (table_id, record_id)
      )`.compile(db)
    );
    await db.executeQuery(
      sql`insert into ${sql.table(DIRTY_TABLE)} (table_id, record_id)
        values (${TABLE_A}, ${'recA1'}), (${TABLE_A}, ${'recA2'})`.compile(db)
    );
    await insertLedgerRows([
      // Overlaps the dirty table: the ledger branch anti-join must drop it.
      { kind: 'excluded', tableId: TABLE_A, recordId: 'recA2' },
      { kind: 'excluded', tableId: TABLE_A, recordId: 'recA3' },
    ]);

    const result = await collectStageOutputSeedGroups(db, SCOPE_ID, [TABLE_A], {
      seedAllThreshold: 100,
      exactIdsTotalCap: 100,
    });

    expect(result.isOk()).toBe(true);
    const { groups } = result._unsafeUnwrap();
    expect(groups).toHaveLength(1);
    expect([...groups[0].recordIds].sort()).toEqual(['recA1', 'recA2', 'recA3']);
  });
});
