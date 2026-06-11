import { BaseId, FieldId, TableId, type ILogger } from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import { ExternalComputedRefreshService } from './ExternalComputedRefreshService';

const createIdSet = () => {
  return {
    baseId: BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap(),
    tableAId: TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap(),
    tableBId: TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap(),
    fieldA1Id: FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap(),
    fieldA2Id: FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap(),
    fieldB1Id: FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap(),
    fieldB2Id: FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap(),
  };
};

const createPlan = (
  baseId: BaseId,
  seedTableId: TableId,
  steps: Array<{ tableId: TableId; fieldIds: FieldId[]; level: number }>
) => ({
  baseId,
  seedTableId,
  seedRecordIds: [],
  extraSeedRecords: [],
  steps,
  edges: [],
  estimatedComplexity: 0,
  changeType: 'update' as const,
  sameTableBatches: [],
});

const okResult = <T>(value: T) => ({
  isErr: () => false,
  isOk: () => true,
  value,
});

const createLogger = (): ILogger => {
  const logger: ILogger = {
    child: () => logger,
    scope: () => logger,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return logger;
};

describe('ExternalComputedRefreshService', () => {
  it('walks the planned dependency closure without reprocessing duplicate fields', async () => {
    const ids = createIdSet();
    const tableA = { id: () => ids.tableAId } as unknown;
    const tableB = { id: () => ids.tableBId } as unknown;

    const tableRepository = {
      findOne: vi
        .fn()
        .mockResolvedValueOnce(okResult(tableA))
        .mockResolvedValueOnce(okResult(tableA))
        .mockResolvedValueOnce(okResult(tableB))
        .mockResolvedValueOnce(okResult(tableB)),
    };
    const computedUpdatePlanner = {
      plan: vi
        .fn()
        .mockResolvedValueOnce(
          okResult(
            createPlan(ids.baseId, ids.tableAId, [
              {
                tableId: ids.tableAId,
                fieldIds: [ids.fieldA1Id, ids.fieldA2Id],
                level: 0,
              },
              {
                tableId: ids.tableBId,
                fieldIds: [ids.fieldB1Id],
                level: 1,
              },
            ])
          )
        )
        .mockResolvedValueOnce(okResult(createPlan(ids.baseId, ids.tableAId, [])))
        .mockResolvedValueOnce(
          okResult(
            createPlan(ids.baseId, ids.tableBId, [
              {
                tableId: ids.tableBId,
                fieldIds: [ids.fieldB1Id, ids.fieldB2Id],
                level: 0,
              },
            ])
          )
        )
        .mockResolvedValueOnce(okResult(createPlan(ids.baseId, ids.tableBId, []))),
    };
    const cascadeService = {
      cascade: vi.fn().mockResolvedValue(okResult(undefined)),
    };
    const service = new ExternalComputedRefreshService(
      tableRepository as never,
      cascadeService as never,
      computedUpdatePlanner as never,
      createLogger()
    );

    const result = await service.refreshAfterExternalValueChanges(
      {
        actorId: { toString: () => `usr${'h'.repeat(17)}` },
        requestId: 'test-request-id',
      } as never,
      {
        changes: [
          {
            tableId: ids.tableAId,
            fieldIds: [ids.fieldA1Id],
          },
        ],
      }
    );

    expect(result.isOk()).toBe(true);
    expect(cascadeService.cascade).toHaveBeenCalledTimes(4);
    expect(
      cascadeService.cascade.mock.calls.map(
        ([, input]: [
          unknown,
          { table: { id: () => TableId }; valueChangedFieldIds: FieldId[] },
        ]) => ({
          tableId: input.table.id().toString(),
          fieldIds: input.valueChangedFieldIds.map((fieldId) => fieldId.toString()),
        })
      )
    ).toEqual([
      {
        tableId: ids.tableAId.toString(),
        fieldIds: [ids.fieldA1Id.toString()],
      },
      {
        tableId: ids.tableAId.toString(),
        fieldIds: [ids.fieldA2Id.toString()],
      },
      {
        tableId: ids.tableBId.toString(),
        fieldIds: [ids.fieldB1Id.toString()],
      },
      {
        tableId: ids.tableBId.toString(),
        fieldIds: [ids.fieldB2Id.toString()],
      },
    ]);
  });
});
