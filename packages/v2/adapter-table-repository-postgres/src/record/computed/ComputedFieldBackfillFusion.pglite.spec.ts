import { ActorId, FormulaExpression, FormulaField } from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { createPGliteDb } from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { makeBackfillFusionTable as makeTable } from './__tests__/backfillFusionFixture';

import {
  ComputedFieldBackfillService,
  planBackfillFieldChunks,
} from './ComputedFieldBackfillService';

describe('bounded formula backfill fusion', () => {
  it('keeps function calls and expression budgets at statement boundaries', () => {
    const table = makeTable(['1', '2', 'NOW()', '3', '4']);
    expect(
      planBackfillFieldChunks(table, table.getFields().slice(1)).map((chunk) => chunk.length)
    ).toEqual([2, 1, 2]);
    const numeric = makeTable([`{fld${'a'.repeat(16)}} * 2`, `{fld${'a'.repeat(16)}} + 1`]);
    expect(planBackfillFieldChunks(numeric, numeric.getFields().slice(1))).toHaveLength(1);
    const repeated = numeric.getFields()[1];
    expect(planBackfillFieldChunks(numeric, [repeated, repeated])).toHaveLength(2);
    const wide = makeTable(Array.from({ length: 18 }, () => '1'));
    expect(
      planBackfillFieldChunks(wide, wide.getFields().slice(1)).map((chunk) => chunk.length)
    ).toEqual([8, 8, 2]);
    const bounded = makeTable(Array.from({ length: 7 }, () => `${'1 + '.repeat(40)}1`));
    expect(
      planBackfillFieldChunks(bounded, bounded.getFields().slice(1)).map((chunk) => chunk.length)
    ).toEqual([6, 1]);
    const oversized = makeTable(['1', `${'1 + '.repeat(70)}1`, '2']);
    expect(
      planBackfillFieldChunks(oversized, oversized.getFields().slice(1)).map(
        (chunk) => chunk.length
      )
    ).toEqual([1, 1, 1]);
  });

  it('keeps formulas reading computed fields separate, including missing dependency metadata', () => {
    const table = makeTable(['1', '2', '3']);
    const fields = table.getFields().slice(1);
    const dependent = fields[1];
    if (!(dependent instanceof FormulaField)) throw new Error('Expected formula');
    dependent
      .setExpression(FormulaExpression.create(`{${fields[0].id()}} + 1`)._unsafeUnwrap())
      ._unsafeUnwrap();
    expect(planBackfillFieldChunks(table, fields).map((chunk) => chunk.length)).toEqual([1, 1, 1]);
  });

  it.each([false, true])(
    'matches singleton values and versions, skipDistinctFilter=%s',
    async (skipDistinctFilter) => {
      const { db, pglite } = await createPGliteDb();
      try {
        const table = makeTable();
        const fields = table.getFields().slice(1);
        await pglite.exec(
          'CREATE TABLE fusion (__id text PRIMARY KEY, __version integer, col_0 double precision, col_1 double precision, col_2 double precision)'
        );
        const initial =
          "INSERT INTO fusion VALUES ('a', 10, 1, NULL, NULL), ('b', 10, 1, 2, NULL), ('c', 10, 1, NULL, 6), ('d', 10, 1, 2, 6)";
        const service = new ComputedFieldBackfillService(
          { findOne: vi.fn(async () => ok(table)) } as never,
          { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
          {} as never,
          db,
          {} as never,
          { mode: 'sync', hybridThreshold: 10000 },
          new Pg16TypeValidationStrategy()
        );
        const context = {
          actorId: ActorId.create(`usr${'a'.repeat(16)}`)._unsafeUnwrap({ withStackTrace: true }),
        };
        const execute = vi.spyOn(db, 'executeQuery');
        await pglite.exec(initial);
        for (const field of fields) {
          (
            await service.executeSyncMany(context, { table, fields: [field], skipDistinctFilter })
          )._unsafeUnwrap({ withStackTrace: true });
        }
        const baseline = (await pglite.query('SELECT * FROM fusion ORDER BY __id')).rows;
        const updates = () =>
          execute.mock.calls.filter(([query]) => /update "public"\."fusion"/i.test(query.sql))
            .length;
        expect(updates()).toBe(2);
        await pglite.exec('TRUNCATE fusion');
        await pglite.exec(initial);
        execute.mockClear();
        (
          await service.executeSyncMany(context, { table, fields, skipDistinctFilter })
        )._unsafeUnwrap({ withStackTrace: true });
        expect(updates()).toBe(1);
        expect((await pglite.query('SELECT * FROM fusion ORDER BY __id')).rows).toEqual(baseline);
        expect(baseline.map((row) => (row as { __version: number }).__version)).toEqual(
          skipDistinctFilter ? [12, 12, 12, 12] : [12, 11, 11, 10]
        );
      } finally {
        await db.destroy();
      }
    }
  );
});
