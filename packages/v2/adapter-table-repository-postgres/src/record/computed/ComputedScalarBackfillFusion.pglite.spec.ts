import { ActorId, FormulaField, FormulaExpression } from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { createPGliteDb } from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { makeScalarBackfillTable, scalarBackfillInputIds } from './__tests__/scalarBackfillFixture';
import {
  ComputedFieldBackfillService,
  planBackfillFieldChunks,
} from './ComputedFieldBackfillService';

const context = { actorId: ActorId.create(`usr${'a'.repeat(16)}`)._unsafeUnwrap() };
const seed = `INSERT INTO scalar_fusion (__id, __version, col_0, col_1, col_2, col_3, col_4, col_6) VALUES
 ('rec0000000000000000', 10, NULL, NULL, NULL, NULL, NULL, NULL),
 ('rec0000000000000001', 10, '  Foo  ', 1.25, '2024-03-10 06:30:00+00', TRUE, NULL, NULL),
 ('rec0000000000000002', 10, 'zero', 0, '2024-03-10 07:30:00+00', FALSE, NULL, NULL),
 ('rec0000000000000003', 10, 'NOW() is text', -2.55, '2024-11-03 05:30:00+00', TRUE, NULL, NULL),
 ('rec0000000000000004', 10, '', 8, '2024-11-03 06:30:00+00', FALSE, NULL, NULL),
 ('rec0000000000000005', 10, 'Already', 4.5, NULL, TRUE, 5.5, 'ALREADY')`;

describe('deterministic scalar backfill fusion', () => {
  it('groups mixed scalar outputs and isolates dependent or clock-based formulas', () => {
    const { table, fields } = makeScalarBackfillTable();
    expect(planBackfillFieldChunks(table, fields)).toHaveLength(1);
    const dependent = fields[3];
    if (!(dependent instanceof FormulaField)) throw new Error('Expected formula');
    dependent
      .setExpression(FormulaExpression.create(`UPPER({${fields[2].id()}})`)._unsafeUnwrap())
      ._unsafeUnwrap();
    expect(planBackfillFieldChunks(table, fields).map((chunk) => chunk.length)).toEqual([3, 1, 4]);
    dependent
      .setExpression(FormulaExpression.create('IF(TRUE, "ok", NOW())')._unsafeUnwrap())
      ._unsafeUnwrap();
    expect(planBackfillFieldChunks(table, fields).map((chunk) => chunk.length)).toEqual([3, 1, 4]);
    dependent
      .setExpression(
        FormulaExpression.create(`UPPER({${scalarBackfillInputIds.text}})`)._unsafeUnwrap()
      )
      ._unsafeUnwrap();
    expect(planBackfillFieldChunks(table, fields)).toHaveLength(1);
  });

  it('does not fuse implicit relative-date branches, comparisons or stale datetime metadata', () => {
    const { table, fields } = makeScalarBackfillTable();
    const dateResult = fields[4];
    if (!(dateResult instanceof FormulaField)) throw new Error('Expected formula');
    for (const expression of [
      `IF(TRUE, {${scalarBackfillInputIds.date}}, "now")`,
      `{${scalarBackfillInputIds.date}} < "today"`,
      '"now"',
    ]) {
      dateResult
        .setExpression(FormulaExpression.create(expression)._unsafeUnwrap())
        ._unsafeUnwrap();
      expect(planBackfillFieldChunks(table, fields).map((chunk) => chunk.length)).toEqual([
        4, 1, 3,
      ]);
    }
  });

  it.each([
    { skipDistinctFilter: false, batch: false },
    { skipDistinctFilter: true, batch: false },
    { skipDistinctFilter: false, batch: true },
    { skipDistinctFilter: true, batch: true },
  ])(
    'matches singleton values, errors, versions and row scope: %j',
    async ({ skipDistinctFilter, batch }) => {
      const { db, pglite } = await createPGliteDb();
      try {
        const { table, fields, columnDefinitions } = makeScalarBackfillTable();
        await pglite.exec(
          `CREATE TABLE scalar_fusion (__id text PRIMARY KEY, __version integer, ${columnDefinitions})`
        );
        const service = new ComputedFieldBackfillService(
          { findOne: vi.fn(async () => ok(table)) } as never,
          { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
          {} as never,
          db,
          {} as never,
          { mode: 'sync', hybridThreshold: 10000 },
          new Pg16TypeValidationStrategy()
        );
        const recordBatch = batch ? { cursor: 'rec0000000000000000', size: 3 } : undefined;
        const execute = vi.spyOn(db, 'executeQuery');
        const updateCount = () =>
          execute.mock.calls.filter(([query]) =>
            query.sql.includes('update "public"."scalar_fusion"')
          ).length;
        await pglite.exec(seed);
        for (const field of fields) {
          (
            await service.executeSyncMany(context, {
              table,
              fields: [field],
              skipDistinctFilter,
              recordBatch,
            })
          )._unsafeUnwrap({ withStackTrace: true });
        }
        const expected = (
          await pglite.query<Record<string, unknown>>('SELECT * FROM scalar_fusion ORDER BY __id')
        ).rows;
        expect(updateCount()).toBe(8);
        // Existing persisted formula behavior stores the explicit error as NULL.
        expect(expected[2].col_10).toBeNull();
        expect(expected[2].col_11).toBe(true);
        expect(expected[1].col_11).toBe(false);
        expect(expected[1].col_6).toBe('FOO');
        expect(expected[1].col_7).toBe('  Foo  ');
        if (batch) {
          expect(expected[0].__version).toBe(10);
          expect(expected[4].__version).toBe(10);
          expect(expected[5].__version).toBe(10);
        } else {
          expect(expected[5].__version).toBe(skipDistinctFilter ? 18 : 14);
        }
        await pglite.exec('TRUNCATE scalar_fusion');
        await pglite.exec(seed);
        execute.mockClear();
        const result = (
          await service.executeSyncMany(context, { table, fields, skipDistinctFilter, recordBatch })
        )._unsafeUnwrap({ withStackTrace: true });
        expect(updateCount()).toBe(1);
        expect((await pglite.query('SELECT * FROM scalar_fusion ORDER BY __id')).rows).toEqual(
          expected
        );
        if (batch)
          expect(result.batch).toEqual({
            recordCount: 3,
            lastRecordId: 'rec0000000000000003',
            hasMore: true,
          });
      } finally {
        await db.destroy();
      }
    }
  );
});
