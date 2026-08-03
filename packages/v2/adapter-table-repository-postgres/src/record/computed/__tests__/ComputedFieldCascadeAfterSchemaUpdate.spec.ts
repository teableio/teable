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
      backfillMany: vi.fn(async (_context, input) => ok({ fields: input.fields })),
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

  it('backfills downstream planned fields after a changed field was already self-backfilled', async () => {
    const table = createTable();
    const changedFieldId = table.getFields()[0]!.id();
    const downstreamFieldId = table.getFields()[1]!.id();

    const plan: ComputedUpdatePlan = {
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [],
      extraSeedRecords: [],
      steps: [
        {
          tableId: table.id(),
          level: 0,
          fieldIds: [changedFieldId],
        },
        {
          tableId: table.id(),
          level: 1,
          fieldIds: [downstreamFieldId],
        },
      ],
      edges: [],
      estimatedComplexity: 2,
      changeType: 'update',
      sameTableBatches: [],
    };

    const planner: Pick<ComputedUpdatePlanner, 'plan'> = {
      plan: vi.fn(async () => ok(plan)),
    };

    const backfillService: Pick<ComputedFieldBackfillService, 'backfillMany'> = {
      backfillMany: vi.fn(async (_context, input) => ok({ fields: input.fields })),
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
      selfBackfillFieldIds: [changedFieldId],
      valueChangedFieldIds: [changedFieldId],
    });

    expect(result.isOk()).toBe(true);
    expect(backfillService.backfillMany).toHaveBeenCalledTimes(2);
    expect(backfillService.backfillMany).toHaveBeenLastCalledWith(
      context,
      expect.objectContaining({
        fields: [table.getFields()[1]],
      })
    );
  });

  it('keeps planned fields when the earlier changed-field backfill skipped them', async () => {
    const table = createTable();
    const changedFieldId = table.getFields()[0]!.id();

    const plan: ComputedUpdatePlan = {
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [],
      extraSeedRecords: [],
      steps: [
        {
          tableId: table.id(),
          level: 0,
          fieldIds: [changedFieldId],
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
      backfillMany: vi
        .fn()
        .mockResolvedValueOnce(ok({ fields: [] }))
        .mockImplementation(async (_context, input) => ok({ fields: input.fields })),
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
      selfBackfillFieldIds: [],
      valueChangedFieldIds: [changedFieldId],
    });

    expect(result.isOk()).toBe(true);
    expect(backfillService.backfillMany).toHaveBeenCalledTimes(2);
    expect(backfillService.backfillMany).toHaveBeenNthCalledWith(
      1,
      context,
      expect.objectContaining({
        fields: [table.getFields()[0]],
      })
    );
    expect(backfillService.backfillMany).toHaveBeenNthCalledWith(
      2,
      context,
      expect.objectContaining({
        fields: [table.getFields()[0]],
      })
    );
  });
});
