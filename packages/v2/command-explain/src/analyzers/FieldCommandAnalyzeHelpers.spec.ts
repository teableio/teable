import {
  ActorId,
  BaseId,
  DeleteTableCommand,
  FieldName,
  MemoryTableRepository,
  Table,
  TableId,
  TableName,
  v2CoreTokens,
  type IExecutionContext,
  type ITableDeletionPreparationService,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import { createFieldExplainDryRunEnvironment } from './FieldCommandAnalyzeHelpers';

const context: IExecutionContext = { actorId: ActorId.create('system')._unsafeUnwrap() };

describe('field explain preparation container', () => {
  it('prepares table deletion from overlay metadata without writing to the delegate', async () => {
    const repository = new MemoryTableRepository();
    const writes = [
      vi.spyOn(repository, 'insert'),
      vi.spyOn(repository, 'insertMany'),
      vi.spyOn(repository, 'updateOne'),
      vi.spyOn(repository, 'delete'),
      vi.spyOn(repository, 'restore'),
    ];
    const builder = Table.builder()
      .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
      .withId(TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Overlay only')._unsafeUnwrap());
    builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const dryRun = createFieldExplainDryRunEnvironment({
      db: {} as never,
      tableRepository: repository,
      computedUpdatePlanner: {} as never,
      typeValidationStrategy: {} as never,
    });
    (await dryRun.overlayTableRepository.insert(context, table))._unsafeUnwrap();
    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'soft',
    })._unsafeUnwrap();

    const preparation = await dryRun.container
      .resolve<ITableDeletionPreparationService>(v2CoreTokens.tableDeletionPreparationService)
      .prepare(context, command);

    expect(preparation._unsafeUnwrap().table.id().toString()).toBe(table.id().toString());
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(dryRun.captureTableSchemaRepository.getStatements()).toEqual([]);
  });
});
