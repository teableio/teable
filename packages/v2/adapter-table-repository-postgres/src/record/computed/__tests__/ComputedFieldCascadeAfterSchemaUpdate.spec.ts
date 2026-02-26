import { ActorId, BaseId, FieldName, Table, TableId, TableName, ok } from '@teable/v2-core';
import type { IExecutionContext, ITableRepository } from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import { ComputedFieldCascadeAfterSchemaUpdate } from '../ComputedFieldCascadeAfterSchemaUpdate';
import type { ComputedFieldBackfillService } from '../ComputedFieldBackfillService';
import type { ComputedUpdatePlan, ComputedUpdatePlanner } from '../ComputedUpdatePlanner';

const createTable = () => {
  const baseId = BaseId.generate()._unsafeUnwrap();
  const tableId = TableId.generate()._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create('CascadeTable')._unsafeUnwrap());

  builder.field().singleLineText().withName(FieldName.create('A')._unsafeUnwrap()).done();
  builder.field().singleLineText().withName(FieldName.create('B')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();

  return builder.build()._unsafeUnwrap();
};

describe('ComputedFieldCascadeAfterSchemaUpdate', () => {
  it('deduplicates backfill for the same field across self/value/plan stages', async () => {
    const table = createTable();
    const targetFieldId = table.getFields()[0]!.id();

    const plan: ComputedUpdatePlan = {
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [],
      extraSeedRecords: [],
      steps: [
        {
          tableId: table.id(),
          level: 0,
          fieldIds: [targetFieldId],
        },
      ],
      edges: [],
      estimatedComplexity: 1,
      changeType: 'update',
      sameTableBatches: [],
    };

    const planner: Pick<ComputedUpdatePlanner, 'plan'> = {
      plan: vi.fn(async () => ok(plan)),
    };

    const backfillService: Pick<ComputedFieldBackfillService, 'backfillMany'> = {
      backfillMany: vi.fn(async () => ok(undefined)),
    };

    const tableRepository: Pick<ITableRepository, 'findOne'> = {
      findOne: vi.fn(),
    };

    const service = new ComputedFieldCascadeAfterSchemaUpdate(
      planner as ComputedUpdatePlanner,
      backfillService as ComputedFieldBackfillService,
      tableRepository as ITableRepository
    );

    const context: IExecutionContext = {
      actorId: ActorId.create('usr_test')._unsafeUnwrap(),
    };

    const result = await service.cascade(context, {
      table,
      selfBackfillFieldIds: [targetFieldId],
      valueChangedFieldIds: [targetFieldId],
      deferredBackfillFieldIds: [],
      hasDbStorageTypeChange: false,
    });

    expect(result.isOk()).toBe(true);
    expect(backfillService.backfillMany).toHaveBeenCalledTimes(1);
  });
});
