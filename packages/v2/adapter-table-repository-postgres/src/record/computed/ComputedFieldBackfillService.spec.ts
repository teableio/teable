import {
  BaseId,
  CellValueMultiplicity,
  CellValueType,
  FieldId,
  FieldName,
  FormulaExpression,
  FormulaMeta,
  TableId,
  createFormulaField,
  domainError,
  type Field,
  type IExecutionContext,
  type Table,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import {
  ComputedFieldBackfillService,
  defaultFieldBackfillConfig,
  type FieldBackfillConfig,
} from './ComputedFieldBackfillService';

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
    dbTableName: () =>
      ok({
        split: () => ok({ schema: BASE_ID, tableName: HOST_TABLE_ID }),
      }),
  } as unknown as Table;
};

const createComputedField = (id = FIELD_ID): Field => {
  const fieldId = FieldId.create(id)._unsafeUnwrap();
  return {
    id: () => fieldId,
    type: () => ({
      toString: () => 'conditionalLookup',
      equals: () => false,
    }),
    computed: () => ({ toBoolean: () => true }),
  } as unknown as Field;
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
    foreignKeyNameString: () => ok(`__fk_${FIELD_ID}`),
    baseId: () => undefined,
    foreignTableId: () => ({ toString: () => FOREIGN_TABLE_ID }),
    orderColumnName: () => ok(`__fk_${SYMMETRIC_FIELD_ID}_order`),
  };
};

const createManyOneLinkField = () => {
  return {
    id: () => ({ toString: () => FIELD_ID }),
    type: () => ({
      toString: () => 'link',
      equals: () => true,
    }),
    computed: () => ({ toBoolean: () => false }),
    relationship: () => ({ toString: () => 'manyOne' }),
    isOneWay: () => false,
    hasOrderColumn: () => false,
    fkHostTableName: () => ({
      split: () => ok({ schema: BASE_ID, tableName: HOST_TABLE_ID }),
    }),
    selfKeyNameString: () => ok('__id'),
    foreignKeyNameString: () => ok(`__fk_${FIELD_ID}`),
    baseId: () => undefined,
    foreignTableId: () => ({ toString: () => FOREIGN_TABLE_ID }),
    orderColumnName: () => ok(`__fk_${FIELD_ID}_order`),
  };
};

const createSymmetricOneOneLinkField = () => {
  return {
    id: () => ({ toString: () => SYMMETRIC_FIELD_ID }),
    type: () => ({
      toString: () => 'link',
      equals: () => true,
    }),
    computed: () => ({ toBoolean: () => false }),
    relationship: () => ({ toString: () => 'oneOne' }),
    isOneWay: () => false,
    hasOrderColumn: () => false,
    fkHostTableName: () => ({
      split: () => ok({ schema: BASE_ID, tableName: HOST_TABLE_ID }),
    }),
    selfKeyNameString: () => ok(`__fk_${FIELD_ID}`),
    foreignKeyNameString: () => ok('__id'),
    baseId: () => undefined,
    foreignTableId: () => ({ toString: () => HOST_TABLE_ID }),
    orderColumnName: () => ok(`__fk_${FIELD_ID}_order`),
  };
};

const createService = (
  config: FieldBackfillConfig = { mode: 'sync', hybridThreshold: 5000 }
) =>
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
    { sha256: vi.fn(() => 'hash') } as never,
    {} as never,
    {
      enqueueFieldBackfill: vi.fn(async () => ok({ taskId: 'cuo_test', merged: false })),
    } as never,
    config,
    {} as never
  );

describe('ComputedFieldBackfillService collectBackfillFields', () => {
  it('defaults new computed field backfills to hybrid mode', () => {
    expect(defaultFieldBackfillConfig).toEqual({
      mode: 'hybrid',
      hybridThreshold: 10000,
    });
  });

  it('backfills formula fields even when legacy meta says generated column', async () => {
    const service = createService();
    const table = createTestTable();
    const field = createFormulaField({
      id: FieldId.create(FIELD_ID)._unsafeUnwrap(),
      name: FieldName.create('Formula')._unsafeUnwrap(),
      expression: FormulaExpression.create('1 + 1')._unsafeUnwrap(),
      meta: FormulaMeta.rehydrate({ persistedAsGeneratedColumn: true })._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    })._unsafeUnwrap();
    const executeSyncMany = vi.spyOn(service, 'executeSyncMany');

    executeSyncMany.mockResolvedValueOnce(ok({ fields: [field] }));

    const result = await service.backfillMany({} as IExecutionContext, {
      table,
      fields: [field],
    });

    expect(result.isOk()).toBe(true);
    expect(executeSyncMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fields: [field] })
    );
  });

  it('uses oneMany foreign-table fallback when self key is absent on fkHost', async () => {
    const service = createService();
    const table = createTestTable();
    const linkField = createTwoWayOneManyLinkField();
    const columnExists = vi.spyOn(service as any, 'columnExists') as any;

    columnExists.mockResolvedValueOnce(ok(false));
    columnExists.mockResolvedValueOnce(ok(true));
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
    expect(columnExists).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      BASE_ID,
      FOREIGN_TABLE_DB_NAME,
      `__fk_${FIELD_ID}`
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

  it('skips manyOne link when its foreign key column is missing on the host table', async () => {
    const service = createService();
    const table = createTestTable();
    const linkField = createManyOneLinkField();
    const columnExists = vi.spyOn(service as any, 'columnExists') as any;

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
    expect(columnExists).toHaveBeenCalledWith(
      expect.anything(),
      BASE_ID,
      HOST_TABLE_ID,
      `__fk_${FIELD_ID}`
    );
  });

  it('skips symmetric oneOne link when its swapped join column is missing on the fk host', async () => {
    const service = createService();
    const table = createTestTable();
    const linkField = createSymmetricOneOneLinkField();
    const columnExists = vi.spyOn(service as any, 'columnExists') as any;

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
    expect(columnExists).toHaveBeenCalledWith(
      expect.anything(),
      BASE_ID,
      HOST_TABLE_ID,
      `__fk_${FIELD_ID}`
    );
  });

  it('skips two-way oneMany link when its foreign key column is missing on the fk host', async () => {
    const service = createService();
    const table = createTestTable();
    const linkField = createTwoWayOneManyLinkField();
    const columnExists = vi.spyOn(service as any, 'columnExists') as any;

    columnExists.mockResolvedValueOnce(ok(true));
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
      HOST_TABLE_ID,
      `__fk_${FIELD_ID}`
    );
  });

  it('falls back to an outbox task when sync computed backfill fails', async () => {
    const service = createService();
    const table = createTestTable();
    const field = createComputedField();
    const syncFailure = domainError.infrastructure({ message: 'computed query timed out' });
    const executeSyncMany = vi.spyOn(service, 'executeSyncMany');

    executeSyncMany.mockResolvedValueOnce(err(syncFailure));

    const result = await service.backfillMany({} as IExecutionContext, {
      table,
      fields: [field],
    });

    expect(result.isOk()).toBe(true);
    expect(executeSyncMany).toHaveBeenCalledTimes(1);
    expect((service as any).logger.warn).toHaveBeenCalledWith(
      'computed:backfillMany:sync_failed_enqueue_fallback',
      expect.objectContaining({
        tableId: HOST_TABLE_ID,
        fieldIds: [FIELD_ID],
        error: 'computed query timed out',
      })
    );
    expect((service as any).outbox.enqueueFieldBackfill).toHaveBeenCalledTimes(1);
  });

  it('returns original sync failure when outbox fallback also fails', async () => {
    const service = createService();
    const table = createTestTable();
    const field = createComputedField();
    const syncFailure = domainError.infrastructure({ message: 'operator does not exist' });
    const outboxFailure = domainError.infrastructure({
      message: 'Outbox transaction failed: current transaction is aborted',
    });
    const executeSyncMany = vi.spyOn(service, 'executeSyncMany');

    executeSyncMany.mockResolvedValueOnce(err(syncFailure));
    (service as any).outbox.enqueueFieldBackfill.mockResolvedValueOnce(err(outboxFailure));

    const result = await service.backfillMany({} as IExecutionContext, {
      table,
      fields: [field],
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe(syncFailure);
      expect(result.error.message).toBe('operator does not exist');
    }
    expect((service as any).logger.warn).toHaveBeenCalledWith(
      'computed:backfillMany:enqueue_fallback_failed',
      expect.objectContaining({
        tableId: HOST_TABLE_ID,
        fieldIds: [FIELD_ID],
        error: 'operator does not exist',
        fallbackError: 'Outbox transaction failed: current transaction is aborted',
      })
    );
  });

  it('enqueues multi-field transaction backfills instead of building one wide sync query', async () => {
    const service = createService();
    const table = createTestTable();
    const fieldA = createComputedField(`fld${'g'.repeat(16)}`);
    const fieldB = createComputedField(`fld${'h'.repeat(16)}`);
    const executeSyncMany = vi.spyOn(service, 'executeSyncMany');

    const result = await service.backfillMany(
      {
        transaction: { kind: 'unitOfWorkTransaction' },
      } as IExecutionContext,
      {
        table,
        fields: [fieldA, fieldB],
      }
    );

    expect(result.isOk()).toBe(true);
    expect(executeSyncMany).not.toHaveBeenCalled();
    expect((service as any).logger.info).toHaveBeenCalledWith(
      'computed:backfillMany:transaction_enqueue',
      expect.objectContaining({
        tableId: HOST_TABLE_ID,
        fieldIds: [`fld${'g'.repeat(16)}`, `fld${'h'.repeat(16)}`],
      })
    );
    expect((service as any).outbox.enqueueFieldBackfill).toHaveBeenCalledTimes(1);
  });

  it('keeps hybrid field backfill synchronous for small tables', async () => {
    const service = createService({ mode: 'hybrid', hybridThreshold: 5000 });
    const table = createTestTable();
    const field = createComputedField();
    const estimateTableRowCount = vi.spyOn(service as any, 'estimateTableRowCount');
    const executeSyncMany = vi.spyOn(service, 'executeSyncMany');

    estimateTableRowCount.mockResolvedValueOnce(10);
    executeSyncMany.mockResolvedValueOnce(ok({ fields: [field] }));

    const result = await service.backfillMany({} as IExecutionContext, {
      table,
      fields: [field],
    });

    expect(result.isOk()).toBe(true);
    expect(executeSyncMany).toHaveBeenCalledTimes(1);
    expect((service as any).outbox.enqueueFieldBackfill).not.toHaveBeenCalled();
  });

  it('enqueues hybrid field backfill for large tables', async () => {
    const service = createService({ mode: 'hybrid', hybridThreshold: 5000 });
    const table = createTestTable();
    const field = createComputedField();
    const estimateTableRowCount = vi.spyOn(service as any, 'estimateTableRowCount');
    const executeSyncMany = vi.spyOn(service, 'executeSyncMany');

    estimateTableRowCount.mockResolvedValueOnce(5001);

    const result = await service.backfillMany({} as IExecutionContext, {
      table,
      fields: [field],
    });

    expect(result.isOk()).toBe(true);
    expect(executeSyncMany).not.toHaveBeenCalled();
    expect((service as any).outbox.enqueueFieldBackfill).toHaveBeenCalledTimes(1);
  });

  it('enqueues hybrid transaction backfill when table row estimate is unavailable', async () => {
    const service = createService({ mode: 'hybrid', hybridThreshold: 5000 });
    const table = createTestTable();
    const field = createComputedField();
    const estimateTableRowCount = vi.spyOn(service as any, 'estimateTableRowCount');
    const executeSyncMany = vi.spyOn(service, 'executeSyncMany');

    estimateTableRowCount.mockResolvedValueOnce(undefined);

    const result = await service.backfillMany(
      {
        transaction: { kind: 'unitOfWorkTransaction' },
      } as IExecutionContext,
      {
        table,
        fields: [field],
      }
    );

    expect(result.isOk()).toBe(true);
    expect(executeSyncMany).not.toHaveBeenCalled();
    expect((service as any).logger.warn).toHaveBeenCalledWith(
      'computed:backfill:row_count_estimate_unavailable',
      expect.objectContaining({
        tableId: HOST_TABLE_ID,
        mode: 'hybrid',
        fallback: 'async',
        inTransaction: true,
      })
    );
    expect((service as any).outbox.enqueueFieldBackfill).toHaveBeenCalledTimes(1);
  });
});
