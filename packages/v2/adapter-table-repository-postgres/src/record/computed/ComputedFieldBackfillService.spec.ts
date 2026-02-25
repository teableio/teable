import { BaseId, TableId, type IExecutionContext, type Table } from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { ComputedFieldBackfillService } from './ComputedFieldBackfillService';

const BASE_ID = `bse${'a'.repeat(16)}`;
const HOST_TABLE_ID = `tbl${'b'.repeat(16)}`;
const FOREIGN_TABLE_ID = `tbl${'c'.repeat(16)}`;
const FOREIGN_TABLE_DB_NAME = 'table2_216';
const FIELD_ID = `fld${'d'.repeat(16)}`;
const SYMMETRIC_FIELD_ID = `fld${'f'.repeat(16)}`;

const createTestTable = (): Table => {
  const id = TableId.create(HOST_TABLE_ID)._unsafeUnwrap();
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  return {
    id: () => id,
    baseId: () => baseId,
  } as unknown as Table;
};

const createTwoWayOneManyLinkField = () => {
  return {
    id: () => ({ toString: () => FIELD_ID }),
    type: () => ({
      toString: () => 'link',
      equals: () => true,
    }),
    computed: () => ({ toBoolean: () => false }),
    relationship: () => ({ toString: () => 'oneMany' }),
    isOneWay: () => false,
    hasOrderColumn: () => false,
    fkHostTableName: () => ({
      split: () => ok({ schema: BASE_ID, tableName: HOST_TABLE_ID }),
    }),
    selfKeyNameString: () => ok(`__fk_${SYMMETRIC_FIELD_ID}`),
    baseId: () => undefined,
    foreignTableId: () => ({ toString: () => FOREIGN_TABLE_ID }),
    orderColumnName: () => ok(`__fk_${SYMMETRIC_FIELD_ID}_order`),
  };
};

const createService = () =>
  new ComputedFieldBackfillService(
    {
      findOne: vi.fn().mockResolvedValue(
        ok({
          dbTableName: () =>
            ok({
              split: () => ok({ schema: BASE_ID, tableName: FOREIGN_TABLE_DB_NAME }),
            }),
        })
      ),
    } as never,
    {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as never,
    { hash: vi.fn() } as never,
    {} as never,
    { enqueueBackfill: vi.fn(), enqueueManyBackfill: vi.fn() } as never,
    { mode: 'sync', hybridThreshold: 5000 },
    {} as never
  );

describe('ComputedFieldBackfillService collectBackfillFields', () => {
  it('uses oneMany foreign-table fallback when self key is absent on fkHost', async () => {
    const service = createService();
    const table = createTestTable();
    const linkField = createTwoWayOneManyLinkField();
    const columnExists = vi.spyOn(service as any, 'columnExists') as any;

    columnExists.mockResolvedValueOnce(ok(false));
    columnExists.mockResolvedValueOnce(ok(true));

    const result = await (
      service as unknown as {
        collectBackfillFields: (
          context: IExecutionContext,
          input: { table: Table; fields: unknown[]; includeOneManyTwoWay?: boolean }
        ) => Promise<any>;
      }
    ).collectBackfillFields({} as IExecutionContext, {
      table,
      fields: [linkField],
      includeOneManyTwoWay: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
    }
    expect(columnExists).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      BASE_ID,
      HOST_TABLE_ID,
      `__fk_${SYMMETRIC_FIELD_ID}`
    );
    expect(columnExists).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      BASE_ID,
      FOREIGN_TABLE_DB_NAME,
      `__fk_${SYMMETRIC_FIELD_ID}`
    );
  });

  it('skips oneMany link when self key is absent on both fkHost and foreign table', async () => {
    const service = createService();
    const table = createTestTable();
    const linkField = createTwoWayOneManyLinkField();
    const columnExists = vi.spyOn(service as any, 'columnExists') as any;

    columnExists.mockResolvedValueOnce(ok(false));
    columnExists.mockResolvedValueOnce(ok(false));

    const result = await (
      service as unknown as {
        collectBackfillFields: (
          context: IExecutionContext,
          input: { table: Table; fields: unknown[]; includeOneManyTwoWay?: boolean }
        ) => Promise<any>;
      }
    ).collectBackfillFields({} as IExecutionContext, {
      table,
      fields: [linkField],
      includeOneManyTwoWay: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(0);
    }
  });
});
