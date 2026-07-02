import { FieldType } from '@teable/core';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputedEvaluatorService as ComputedEvaluatorServiceType } from './computed-evaluator.service';

type IComputedEvaluatorServiceCtor = new (...args: unknown[]) => ComputedEvaluatorServiceType;

vi.mock('@teable/db-main-prisma', () => ({
  PrismaService: class PrismaService {},
}));

vi.mock('../../../../global/database-router.service', () => ({
  DatabaseRouter: class DatabaseRouter {},
}));

vi.mock('../../query-builder', () => ({
  ['InjectRecordQueryBuilder']: () => () => undefined,
}));

vi.mock('../../../calculation/batch.service', () => ({
  BatchService: class BatchService {},
}));

vi.mock('./record-computed-update.service', () => ({
  RecordComputedUpdateService: class RecordComputedUpdateService {},
}));

describe('ComputedEvaluatorService', () => {
  const tableId = 'tblLookupRepoint';
  const lookupFieldId = 'fldLookup';
  const formulaFieldId = 'fldFormula';
  const recordId = 'recLookupRepoint';

  const createField = (field: {
    id: string;
    type: FieldType;
    dbFieldName: string;
    isLookup?: boolean;
  }) =>
    ({
      ...field,
      convertDBValue2CellValue: (value: unknown) => value,
      getIsPersistedAsGeneratedColumn: () => false,
    }) as never;

  let createRecordQueryBuilder: ReturnType<typeof vi.fn>;
  let updateFromSelect: ReturnType<typeof vi.fn>;
  let saveRawOps: ReturnType<typeof vi.fn>;
  let queryRaw: ReturnType<typeof vi.fn>;
  let computedEvaluatorServiceClass: IComputedEvaluatorServiceCtor;

  beforeAll(async () => {
    const module = await import('./computed-evaluator.service');
    computedEvaluatorServiceClass =
      module.ComputedEvaluatorService as IComputedEvaluatorServiceCtor;
  });

  beforeEach(() => {
    const qb = {
      clone: vi.fn(),
      whereIn: vi.fn().mockReturnThis(),
    };
    qb.clone.mockReturnValue(qb);
    createRecordQueryBuilder = vi.fn().mockResolvedValue({
      qb,
      alias: '',
    });
    updateFromSelect = vi.fn().mockResolvedValue([
      {
        __id: recordId,
        __version: 1,
        __prev_version: 1,
        lookup_value: 'Ada',
        formula_value: 'Ada Lovelace',
        __auto_number: 1,
      },
    ]);
    saveRawOps = vi.fn();
    queryRaw = vi.fn().mockResolvedValue([
      {
        fromFieldId: lookupFieldId,
        toFieldId: formulaFieldId,
      },
    ]);
  });

  it('uses stored lookup columns only after lookup-like fields have been evaluated', async () => {
    const service = new computedEvaluatorServiceClass(
      { createRecordQueryBuilder } as never,
      { updateFromSelect } as never,
      { saveRawOps } as never,
      { txClient: () => ({ $queryRaw: queryRaw }) } as never
    );

    await service.evaluate(
      {
        [tableId]: {
          fieldIds: new Set([lookupFieldId, formulaFieldId]),
          recordIds: new Set([recordId]),
        },
      },
      {
        excludeFieldIds: new Set([lookupFieldId, formulaFieldId]),
        tableDomains: new Map([
          [
            tableId,
            {
              dbTableName: 'table_lookup_repoint',
              fieldList: [
                createField({
                  id: lookupFieldId,
                  type: FieldType.SingleLineText,
                  dbFieldName: 'lookup_value',
                  isLookup: true,
                }),
                createField({
                  id: formulaFieldId,
                  type: FieldType.Formula,
                  dbFieldName: 'formula_value',
                }),
              ],
            },
          ],
        ]) as never,
      }
    );

    expect(createRecordQueryBuilder).toHaveBeenCalledTimes(2);
    expect(createRecordQueryBuilder.mock.calls[0][1]).toMatchObject({
      projection: [lookupFieldId],
      preferStoredLookupFields: false,
    });
    expect(createRecordQueryBuilder.mock.calls[1][1]).toMatchObject({
      projection: [formulaFieldId],
      preferStoredLookupFields: true,
    });
    expect(updateFromSelect).toHaveBeenCalledTimes(2);
  });
});
