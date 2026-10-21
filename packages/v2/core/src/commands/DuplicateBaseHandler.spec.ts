import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { domainError } from '../domain/shared/DomainError';
import type { BaseDataBulkCopyPlan, BaseDataBulkCopyProgress } from '../ports/BaseDataBulkCopier';
import { DuplicateBaseCommand } from './DuplicateBaseCommand';
import { DuplicateBaseHandler } from './DuplicateBaseHandler';

const baseId = `bse${'d'.repeat(16)}`;

const fakeTable = (id: string, name: string, fields: unknown[] = []) => ({
  id: () => ({ toString: () => id }),
  name: () => ({ toString: () => name }),
  getFields: () => fields,
});

const createHandler = (
  overrides: {
    foreignTableLoaderService?: unknown;
    tableCreationService?: unknown;
    tableRecordRepository?: unknown;
    eventBus?: unknown;
    unitOfWork?: unknown;
    computedFieldBackfillService?: unknown;
    tableMapper?: unknown;
    recordWritePluginRunner?: unknown;
    tableOperationPluginRunner?: unknown;
    baseDataBulkCopier?: unknown;
  } = {}
) =>
  new DuplicateBaseHandler(
    (overrides.foreignTableLoaderService ?? {}) as never,
    (overrides.tableCreationService ?? {}) as never,
    (overrides.tableRecordRepository ?? {}) as never,
    (overrides.eventBus ?? {}) as never,
    (overrides.unitOfWork ?? {}) as never,
    (overrides.computedFieldBackfillService ?? {
      executeSyncMany: vi.fn(async () => ok(undefined)),
    }) as never,
    overrides.tableMapper as never,
    overrides.recordWritePluginRunner as never,
    overrides.tableOperationPluginRunner as never,
    overrides.baseDataBulkCopier as never
  );

describe('DuplicateBaseHandler', () => {
  it('restores link fields after streaming non-link record inserts', async () => {
    type LinkUpdateBatch = Array<{ recordId: unknown; fieldValues: Map<string, unknown> }>;
    const operationOrder: string[] = [];
    const insertedFieldIds: string[] = [];
    const linkUpdateItems: LinkUpdateBatch = [];
    const targetTableId = 'tblcccccccccccccccc';
    const targetTextFieldId = 'fldcccccccccccccccc';
    const targetLinkFieldId = 'flddddddddddddddddd';
    const tableRecordRepository = {
      insertManyStream: vi.fn(async (_context, _table, batches: Array<{ records: unknown[] }>) => {
        operationOrder.push('insert');
        for (const record of batches[0]?.records ?? []) {
          insertedFieldIds.push(
            ...(
              record as {
                fields(): {
                  entries(): Array<{ fieldId: { toString(): string } }>;
                };
              }
            )
              .fields()
              .entries()
              .map((entry) => entry.fieldId.toString())
          );
        }
        return ok({ totalInserted: batches[0]?.records.length ?? 0 });
      }),
      updateManyStream: vi.fn(
        async (_context, _table, batches: AsyncIterable<{ _unsafeUnwrap(): LinkUpdateBatch }>) => {
          operationOrder.push('update');
          for await (const batchResult of batches) {
            linkUpdateItems.push(...batchResult._unsafeUnwrap());
          }
          return ok({ totalUpdated: linkUpdateItems.length });
        }
      ),
    };
    const unitOfWork = {
      withTransaction: vi.fn((_context, callback: (tx: unknown) => Promise<unknown>) =>
        callback({ tx: true })
      ),
    };
    const targetTable = {
      ...fakeTable(targetTableId, 'Tasks'),
      updateRecordsStream: vi.fn(function* (
        updates: Array<{ recordId: unknown; fieldValues: Map<string, unknown> }>
      ) {
        yield ok(updates);
      }),
    };
    const pluginExecution = {
      guard: vi.fn(async () => ok(undefined)),
      beforePersist: vi.fn(async () => ok(undefined)),
      afterCommit: vi.fn(async () => undefined),
    };
    const recordWritePluginRunner = {
      prepare: vi.fn(async () => ok(pluginExecution)),
    };
    const handler = createHandler({
      tableRecordRepository,
      unitOfWork,
      recordWritePluginRunner,
    });
    const sourceTextFieldId = 'fldaaaaaaaaaaaaaaaa';
    const sourceLinkFieldId = 'fldbbbbbbbbbbbbbbbb';
    const sourceTableId = 'tblaaaaaaaaaaaaaaaa';
    const recordId = 'recaaaaaaaaaaaaaaaa';
    const records = vi.fn(async function* () {
      yield {
        recordId,
        fields: {
          [sourceTextFieldId]: 'Task A',
          [sourceLinkFieldId]: [{ id: 'recbbbbbbbbbbbbbbbb' }],
        },
      };
    });
    const command = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          tables: [
            {
              id: sourceTableId,
              name: 'Tasks',
              fields: [
                { id: sourceTextFieldId, name: 'Title', type: 'singleLineText' },
                { id: sourceLinkFieldId, name: 'Owner', type: 'link' },
              ],
            },
          ],
        },
        records,
      },
      withRecords: true,
      batchSize: 500,
    })._unsafeUnwrap();

    vi.spyOn(
      handler as unknown as { createTables: (...args: unknown[]) => Promise<unknown> },
      'createTables'
    ).mockResolvedValue(
      ok({
        result: {
          tableIdMap: { [sourceTableId]: targetTableId },
          fieldIdMap: {
            [sourceTextFieldId]: targetTextFieldId,
            [sourceLinkFieldId]: targetLinkFieldId,
          },
          viewIdMap: {},
        },
        tablesBySourceId: new Map([[sourceTableId, targetTable]]),
      }) as never
    );

    const result = await handler.handle({} as never, command);
    for await (const event of result._unsafeUnwrap()) {
      if (event.id === 'error') throw new Error(event.message);
    }

    expect(operationOrder).toEqual(['insert', 'update']);
    expect(records).toHaveBeenNthCalledWith(1, sourceTableId, { phase: 'insert' });
    expect(records).toHaveBeenNthCalledWith(2, sourceTableId, { phase: 'linkRestore' });
    expect(insertedFieldIds).toEqual([targetTextFieldId]);
    expect(linkUpdateItems).toHaveLength(1);
    expect(linkUpdateItems[0]?.fieldValues).toEqual(
      new Map([[targetLinkFieldId, [{ id: 'recbbbbbbbbbbbbbbbb' }]]])
    );
    expect(tableRecordRepository.insertManyStream).toHaveBeenCalledWith(
      expect.anything(),
      targetTable,
      expect.anything(),
      expect.objectContaining({ skipComputedUpdates: true, skipChangedFields: true })
    );
    expect(tableRecordRepository.updateManyStream).toHaveBeenCalledWith(
      expect.anything(),
      targetTable,
      expect.anything(),
      expect.objectContaining({
        skipComputedUpdates: true,
        fillLinkTitles: true,
        assumeEmptyLinkState: true,
      })
    );
    expect(recordWritePluginRunner.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'duplicateStream',
        table: targetTable,
        payload: expect.objectContaining({ recordCount: 1, batchSize: 500 }),
      })
    );
    expect(pluginExecution.guard).toHaveBeenCalledOnce();
    expect(pluginExecution.beforePersist).toHaveBeenCalledOnce();
    expect(pluginExecution.afterCommit).toHaveBeenCalledOnce();
  });

  it('skips restore updates for two-way one-many inverse link fields', async () => {
    const insertedFieldIds: string[] = [];
    const targetTableId = 'tblcccccccccccccccc';
    const targetTextFieldId = 'fldcccccccccccccccc';
    const targetLinkFieldId = 'flddddddddddddddddd';
    const tableRecordRepository = {
      insertManyStream: vi.fn(async (_context, _table, batches: Array<{ records: unknown[] }>) => {
        for (const record of batches[0]?.records ?? []) {
          insertedFieldIds.push(
            ...(
              record as {
                fields(): {
                  entries(): Array<{ fieldId: { toString(): string } }>;
                };
              }
            )
              .fields()
              .entries()
              .map((entry) => entry.fieldId.toString())
          );
        }
        return ok({ totalInserted: batches[0]?.records.length ?? 0 });
      }),
      updateManyStream: vi.fn(async () => ok({ totalUpdated: 0 })),
    };
    const unitOfWork = {
      withTransaction: vi.fn((_context, callback: (tx: unknown) => Promise<unknown>) =>
        callback({ tx: true })
      ),
    };
    const targetTable = {
      ...fakeTable(targetTableId, 'Parents'),
      updateRecordsStream: vi.fn(function* () {
        yield ok([]);
      }),
    };
    const handler = createHandler({
      tableRecordRepository,
      unitOfWork,
    });
    const sourceTextFieldId = 'fldaaaaaaaaaaaaaaaa';
    const sourceLinkFieldId = 'fldbbbbbbbbbbbbbbbb';
    const sourceTableId = 'tblaaaaaaaaaaaaaaaa';
    const records = vi.fn(async function* () {
      yield {
        recordId: 'recaaaaaaaaaaaaaaaa',
        fields: {
          [sourceTextFieldId]: 'Parent A',
          [sourceLinkFieldId]: [{ id: 'recbbbbbbbbbbbbbbbb' }],
        },
      };
    });
    const command = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          tables: [
            {
              id: sourceTableId,
              name: 'Parents',
              fields: [
                { id: sourceTextFieldId, name: 'Title', type: 'singleLineText' },
                {
                  id: sourceLinkFieldId,
                  name: 'Children',
                  type: 'link',
                  options: { relationship: 'oneMany', isOneWay: false },
                },
              ],
            },
          ],
        },
        records,
      },
      withRecords: true,
      batchSize: 500,
    })._unsafeUnwrap();

    vi.spyOn(
      handler as unknown as { createTables: (...args: unknown[]) => Promise<unknown> },
      'createTables'
    ).mockResolvedValue(
      ok({
        result: {
          tableIdMap: { [sourceTableId]: targetTableId },
          fieldIdMap: {
            [sourceTextFieldId]: targetTextFieldId,
            [sourceLinkFieldId]: targetLinkFieldId,
          },
          viewIdMap: {},
        },
        tablesBySourceId: new Map([[sourceTableId, targetTable]]),
      }) as never
    );

    const result = await handler.handle({} as never, command);
    for await (const event of result._unsafeUnwrap()) {
      if (event.id === 'error') throw new Error(event.message);
    }

    expect(records).toHaveBeenCalledTimes(1);
    expect(records).toHaveBeenCalledWith(sourceTableId, { phase: 'insert' });
    expect(insertedFieldIds).toEqual([targetTextFieldId]);
    expect(tableRecordRepository.updateManyStream).not.toHaveBeenCalled();
  });

  it('copies records with insertManyStream in command batches', async () => {
    const tableRecordRepository = {
      insertManyStream: vi.fn((_context, _table, batches: Array<{ records: unknown[] }>) =>
        Promise.resolve(ok({ totalInserted: batches[0]?.records.length ?? 0 }))
      ),
    };
    const unitOfWork = {
      withTransaction: vi.fn((_context, callback: (tx: unknown) => Promise<unknown>) =>
        callback({ tx: true })
      ),
    };
    const handler = createHandler({
      tableRecordRepository,
      unitOfWork,
    });
    const sourceFieldId = 'fldaaaaaaaaaaaaaaaa';
    const targetFieldId = 'fldbbbbbbbbbbbbbbbb';
    const sourceTableId = 'tblaaaaaaaaaaaaaaaa';
    const targetTableId = 'tblbbbbbbbbbbbbbbbb';
    const command = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          tables: [
            {
              id: sourceTableId,
              name: 'People',
              fields: [{ id: sourceFieldId, name: 'Name', type: 'singleLineText' }],
            },
          ],
        },
        records: async function* () {
          yield { fields: { [sourceFieldId]: 'Alice' }, autoNumber: 1 };
          yield { fields: { [sourceFieldId]: 'Bob' }, autoNumber: 2 };
          yield { fields: { [sourceFieldId]: 'Cara' }, autoNumber: 3 };
        },
      },
      withRecords: true,
      batchSize: 2,
    })._unsafeUnwrap();

    vi.spyOn(
      handler as unknown as { createTables: (...args: unknown[]) => Promise<unknown> },
      'createTables'
    ).mockResolvedValue(
      ok({
        result: {
          tableIdMap: { [sourceTableId]: targetTableId },
          fieldIdMap: { [sourceFieldId]: targetFieldId },
          viewIdMap: {},
        },
        tablesBySourceId: new Map([[sourceTableId, fakeTable(targetTableId, 'People')]]),
      }) as never
    );

    const result = await handler.handle({} as never, command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(tableRecordRepository.insertManyStream).toHaveBeenCalledTimes(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'progress',
          phase: 'table_data_progress',
          tableId: targetTableId,
          processedRows: 2,
          batchProcessedRows: 2,
          currentBatch: 1,
        }),
        expect.objectContaining({
          id: 'progress',
          phase: 'table_data_progress',
          tableId: targetTableId,
          processedRows: 3,
          batchProcessedRows: 1,
          currentBatch: 2,
        }),
        expect.objectContaining({
          id: 'progress',
          phase: 'table_data_done',
          tableId: targetTableId,
          processedRows: 3,
        }),
        expect.objectContaining({
          id: 'done',
          recordsLength: 3,
        }),
      ])
    );
  });

  it('scales duplicate record batches down for wide tables', async () => {
    const observedBatchSizes: number[] = [];
    const tableRecordRepository = {
      insertManyStream: vi.fn((_context, _table, batches: Array<{ records: unknown[] }>) => {
        const batchSize = batches[0]?.records.length ?? 0;
        observedBatchSizes.push(batchSize);
        return Promise.resolve(ok({ totalInserted: batchSize }));
      }),
    };
    const unitOfWork = {
      withTransaction: vi.fn((_context, callback: (tx: unknown) => Promise<unknown>) =>
        callback({ tx: true })
      ),
    };
    const handler = createHandler({
      tableRecordRepository,
      unitOfWork,
    });
    const sourceTableId = 'tblaaaaaaaaaaaaaaaa';
    const targetTableId = 'tblbbbbbbbbbbbbbbbb';
    const sourceFieldIds = Array.from(
      { length: 250 },
      (_, index) => `fld${index.toString().padStart(16, 'a')}`
    );
    const fieldIdMap = Object.fromEntries(
      sourceFieldIds.map((sourceFieldId, index) => [
        sourceFieldId,
        `fld${index.toString().padStart(16, 'b')}`,
      ])
    );
    const command = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          tables: [
            {
              id: sourceTableId,
              name: 'Wide table',
              fields: sourceFieldIds.map((id, index) => ({
                id,
                name: `Field ${index}`,
                type: 'singleLineText',
              })),
            },
          ],
        },
        records: async function* () {
          for (let rowIndex = 0; rowIndex < 600; rowIndex++) {
            yield {
              fields: Object.fromEntries(
                sourceFieldIds.map((fieldId, fieldIndex) => [
                  fieldId,
                  `row-${rowIndex}-field-${fieldIndex}`,
                ])
              ),
            };
          }
        },
      },
      withRecords: true,
      batchSize: 500,
    })._unsafeUnwrap();

    vi.spyOn(
      handler as unknown as { createTables: (...args: unknown[]) => Promise<unknown> },
      'createTables'
    ).mockResolvedValue(
      ok({
        result: {
          tableIdMap: { [sourceTableId]: targetTableId },
          fieldIdMap,
          viewIdMap: {},
        },
        tablesBySourceId: new Map([
          [sourceTableId, fakeTable(targetTableId, 'Wide table', sourceFieldIds)],
        ]),
      }) as never
    );

    const result = await handler.handle({} as never, command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(observedBatchSizes).toEqual([232, 232, 136]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'progress',
          phase: 'table_data_progress',
          tableId: targetTableId,
          processedRows: 232,
          batchProcessedRows: 232,
          currentBatch: 1,
        }),
        expect.objectContaining({
          id: 'progress',
          phase: 'table_data_done',
          tableId: targetTableId,
          processedRows: 600,
        }),
      ])
    );
  });

  it('streams table structure progress with table counts', async () => {
    const handler = createHandler();
    const command = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          tables: [
            { id: 'tblSourceA', name: 'A', fields: [] },
            { id: 'tblSourceB', name: 'B', fields: [] },
          ],
        },
        records: async function* () {
          yield undefined as never;
        },
      },
      withRecords: false,
    })._unsafeUnwrap();
    vi.spyOn(
      handler as unknown as { createTables: (...args: unknown[]) => Promise<unknown> },
      'createTables'
    ).mockResolvedValue(
      ok({
        result: {
          tableIdMap: { tblSourceA: 'tblTargetA', tblSourceB: 'tblTargetB' },
          fieldIdMap: {},
          viewIdMap: {},
        },
        tablesBySourceId: new Map([
          ['tblSourceA', fakeTable('tblTargetA', 'A')],
          ['tblSourceB', fakeTable('tblTargetB', 'B')],
        ]),
      }) as never
    );

    const result = await handler.handle({} as never, command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'progress',
          phase: 'table_structure_done',
          tableId: 'tblTargetA',
          tableIndex: 1,
          totalTables: 2,
        }),
        expect.objectContaining({
          id: 'progress',
          phase: 'table_structure_done',
          tableId: 'tblTargetB',
          tableIndex: 2,
          totalTables: 2,
        }),
      ])
    );
  });

  it('creates duplicated table structures with duplicate-only schema options', async () => {
    const tableCreationService = {
      execute: vi.fn(async (_context: unknown, input: { tables: ReadonlyArray<unknown> }) =>
        ok({
          persistedTables: input.tables,
          tableState: new Map(),
          sideEffectEvents: [],
        })
      ),
    };
    const unitOfWork = {
      withTransaction: vi.fn((_context, callback: (tx: unknown) => Promise<unknown>) =>
        callback({ tx: true })
      ),
    };
    const tablePluginExecution = { guard: vi.fn(async () => ok(undefined)) };
    const tableOperationPluginRunner = {
      prepare: vi.fn(async () => ok(tablePluginExecution)),
    };
    const handler = createHandler({
      foreignTableLoaderService: { load: vi.fn(async () => ok([])) },
      tableCreationService,
      eventBus: { publishMany: vi.fn(async () => ok(undefined)) },
      unitOfWork,
      tableOperationPluginRunner,
    });
    const sourceTableId = 'tblSourceA';
    const sourceFieldId = 'fldaaaaaaaaaaaaaaaa';
    const command = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          tables: [
            {
              id: sourceTableId,
              name: 'People',
              fields: [{ id: sourceFieldId, name: 'Name', type: 'singleLineText' }],
            },
          ],
        },
        records: async function* () {
          yield undefined as never;
        },
      },
      withRecords: false,
    })._unsafeUnwrap();

    const result = await handler.handle({} as never, command);
    for await (const event of result._unsafeUnwrap()) {
      if (event.id === 'error') throw new Error(event.message);
    }

    expect(tableCreationService.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        schemaOptions: { optimizeForEmptyTables: true, skipUndoCaptureSetup: true },
        sideEffectOptions: { skipFieldCreationSideEffects: true },
      })
    );
    expect(tableOperationPluginRunner.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'createMany',
        payload: expect.objectContaining({
          baseId: expect.objectContaining({}),
          tables: [
            expect.objectContaining({
              fieldCount: 1,
              viewCount: 1,
              recordCount: 0,
            }),
          ],
        }),
      })
    );
    expect(tablePluginExecution.guard).toHaveBeenCalledOnce();
  });

  it('remaps aiConfig references when duplicating fields', async () => {
    const handler = createHandler();
    const sourceBaseId = 'bseSource';
    const sourcePrimaryFieldId = 'fldPrimary';
    const sourceAiFieldId = 'fldAi';

    const result = await (
      handler as unknown as {
        remapStructure: (
          baseId: BaseId,
          normalized: {
            id?: string;
            tables: Array<{
              id?: string;
              name: string;
              fields: Array<{
                id?: string;
                name: string;
                type: string;
                aiConfig?: unknown;
              }>;
            }>;
          }
        ) => Promise<
          Result<
            {
              remapped: {
                tables: Array<{
                  fields: Array<{ id?: string; name: string; aiConfig?: unknown }>;
                }>;
              };
              fieldIdMap: Record<string, string>;
            },
            unknown
          >
        >;
      }
    ).remapStructure(BaseId.create(baseId)._unsafeUnwrap(), {
      id: sourceBaseId,
      tables: [
        {
          id: 'tblSource',
          name: 'People',
          fields: [
            {
              id: sourcePrimaryFieldId,
              name: 'Name',
              type: 'singleLineText',
            },
            {
              id: sourceAiFieldId,
              name: 'AI Summary',
              type: 'singleLineText',
              aiConfig: {
                modelKey: 'test-e2e',
                sourceFieldId: sourcePrimaryFieldId,
              },
            },
          ],
        },
      ],
    });

    const { remapped, fieldIdMap } = result._unsafeUnwrap();
    const duplicatedAiField = remapped.tables[0]!.fields.find(({ name }) => name === 'AI Summary');

    expect(duplicatedAiField?.aiConfig).toEqual({
      modelKey: 'test-e2e',
      sourceFieldId: fieldIdMap[sourcePrimaryFieldId],
    });
  });

  it('backfills computed fields after record and link restore complete', async () => {
    const operationOrder: string[] = [];
    const targetTable = fakeTable('tblbbbbbbbbbbbbbbbb', 'People', [{ id: 'fldComputed' }]);
    const tableRecordRepository = {
      insertManyStream: vi.fn(async () => {
        operationOrder.push('insert');
        return ok({ totalInserted: 1 });
      }),
      updateManyStream: vi.fn(async () => {
        operationOrder.push('linkRestore');
        return ok({ totalUpdated: 0 });
      }),
    };
    const computedFieldBackfillService = {
      executeSyncMany: vi.fn(async () => {
        operationOrder.push('backfill');
        return ok(undefined);
      }),
    };
    const handler = createHandler({
      tableRecordRepository,
      unitOfWork: {
        withTransaction: vi.fn((_context, callback: (tx: unknown) => Promise<unknown>) =>
          callback({ tx: true })
        ),
      },
      computedFieldBackfillService,
    });
    const sourceTableId = 'tblaaaaaaaaaaaaaaaa';
    const sourceFieldId = 'fldaaaaaaaaaaaaaaaa';
    const sourceLinkFieldId = 'fldcccccccccccccccc';
    const command = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          tables: [
            {
              id: sourceTableId,
              name: 'People',
              fields: [
                { id: sourceFieldId, name: 'Name', type: 'singleLineText' },
                { id: sourceLinkFieldId, name: 'Friend', type: 'link' },
              ],
            },
          ],
        },
        records: async function* () {
          yield { fields: { [sourceFieldId]: 'Alice', [sourceLinkFieldId]: [] } };
        },
      },
      withRecords: true,
    })._unsafeUnwrap();

    vi.spyOn(
      handler as unknown as { createTables: (...args: unknown[]) => Promise<unknown> },
      'createTables'
    ).mockResolvedValue(
      ok({
        result: {
          tableIdMap: { [sourceTableId]: 'tblbbbbbbbbbbbbbbbb' },
          fieldIdMap: {
            [sourceFieldId]: 'fldbbbbbbbbbbbbbbbb',
            [sourceLinkFieldId]: 'flddddddddddddddddd',
          },
          viewIdMap: {},
        },
        tablesBySourceId: new Map([[sourceTableId, targetTable]]),
      }) as never
    );

    const result = await handler.handle({ requestId: 'ctx' } as never, command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(operationOrder).toEqual(['insert', 'linkRestore', 'backfill']);
    expect(computedFieldBackfillService.executeSyncMany).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'ctx' }),
      {
        table: targetTable,
        fields: targetTable.getFields(),
        skipDistinctFilter: true,
        includeOneManyTwoWay: true,
      }
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'done',
          recordsLength: 1,
        }),
      ])
    );
  });

  it('returns an error event when duplicate computed backfill fails', async () => {
    const failure = domainError.infrastructure({
      message: 'computed backfill failed',
      code: 'computed.backfill_failed',
    });
    const targetTable = fakeTable('tblbbbbbbbbbbbbbbbb', 'People', [{ id: 'fldComputed' }]);
    const handler = createHandler({
      tableRecordRepository: {
        insertManyStream: vi.fn(async () => ok({ totalInserted: 1 })),
        updateManyStream: vi.fn(async () => ok({ totalUpdated: 0 })),
      },
      unitOfWork: {
        withTransaction: vi.fn((_context, callback: (tx: unknown) => Promise<unknown>) =>
          callback({ tx: true })
        ),
      },
      computedFieldBackfillService: {
        executeSyncMany: vi.fn(async () => err(failure)),
      },
    });
    const sourceTableId = 'tblaaaaaaaaaaaaaaaa';
    const sourceFieldId = 'fldaaaaaaaaaaaaaaaa';
    const command = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          tables: [
            {
              id: sourceTableId,
              name: 'People',
              fields: [{ id: sourceFieldId, name: 'Name', type: 'singleLineText' }],
            },
          ],
        },
        records: async function* () {
          yield { fields: { [sourceFieldId]: 'Alice' } };
        },
      },
      withRecords: true,
    })._unsafeUnwrap();

    vi.spyOn(
      handler as unknown as { createTables: (...args: unknown[]) => Promise<unknown> },
      'createTables'
    ).mockResolvedValue(
      ok({
        result: {
          tableIdMap: { [sourceTableId]: 'tblbbbbbbbbbbbbbbbb' },
          fieldIdMap: { [sourceFieldId]: 'fldbbbbbbbbbbbbbbbb' },
          viewIdMap: {},
        },
        tablesBySourceId: new Map([[sourceTableId, targetTable]]),
      }) as never
    );

    const result = await handler.handle({} as never, command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(events).toContainEqual({
      id: 'error',
      message: 'computed backfill failed',
      code: 'computed.backfill_failed',
    });
    expect(events).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'done' })]));
  });

  it('stops before computed backfill when link restore fails', async () => {
    const failure = domainError.infrastructure({
      message: 'link restore failed',
      code: 'duplicate_base.link_restore_failed',
    });
    const targetTable = {
      ...fakeTable('tblbbbbbbbbbbbbbbbb', 'People'),
      updateRecordsStream: vi.fn(function* () {
        yield ok([]);
      }),
    };
    const computedFieldBackfillService = {
      executeSyncMany: vi.fn(async () => ok(undefined)),
    };
    const handler = createHandler({
      tableRecordRepository: {
        insertManyStream: vi.fn(async () => ok({ totalInserted: 1 })),
        updateManyStream: vi.fn(async () => err(failure)),
      },
      unitOfWork: {
        withTransaction: vi.fn((_context, callback: (tx: unknown) => Promise<unknown>) =>
          callback({ tx: true })
        ),
      },
      computedFieldBackfillService,
    });
    const sourceTableId = 'tblaaaaaaaaaaaaaaaa';
    const sourceFieldId = 'fldaaaaaaaaaaaaaaaa';
    const sourceLinkFieldId = 'fldcccccccccccccccc';
    const command = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          tables: [
            {
              id: sourceTableId,
              name: 'People',
              fields: [
                { id: sourceFieldId, name: 'Name', type: 'singleLineText' },
                { id: sourceLinkFieldId, name: 'Friend', type: 'link' },
              ],
            },
          ],
        },
        records: async function* () {
          yield {
            recordId: 'recaaaaaaaaaaaaaaaa',
            fields: { [sourceFieldId]: 'Alice', [sourceLinkFieldId]: [] },
          };
        },
      },
      withRecords: true,
    })._unsafeUnwrap();

    vi.spyOn(
      handler as unknown as { createTables: (...args: unknown[]) => Promise<unknown> },
      'createTables'
    ).mockResolvedValue(
      ok({
        result: {
          tableIdMap: { [sourceTableId]: 'tblbbbbbbbbbbbbbbbb' },
          fieldIdMap: {
            [sourceFieldId]: 'fldbbbbbbbbbbbbbbbb',
            [sourceLinkFieldId]: 'flddddddddddddddddd',
          },
          viewIdMap: {},
        },
        tablesBySourceId: new Map([[sourceTableId, targetTable]]),
      }) as never
    );

    const result = await handler.handle({} as never, command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(events).toContainEqual({
      id: 'error',
      message: 'link restore failed',
      code: 'duplicate_base.link_restore_failed',
    });
    expect(computedFieldBackfillService.executeSyncMany).not.toHaveBeenCalled();
    expect(events).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'done' })]));
  });

  it('uses the bulk copier for same-database duplication and skips row streaming', async () => {
    const sourceTableId = 'tblaaaaaaaaaaaaaaaa';
    const targetTableId = 'tblbbbbbbbbbbbbbbbb';
    const sourceTextFieldId = 'fldaaaaaaaaaaaaaaaa';
    const targetTextFieldId = 'fldbbbbbbbbbbbbbbbb';
    const sourceLinkFieldId = 'fldcccccccccccccccc';
    const targetLinkFieldId = 'flddddddddddddddddd';
    const fieldIdMap = {
      [sourceTextFieldId]: targetTextFieldId,
      [sourceLinkFieldId]: targetLinkFieldId,
    };
    const tableIdMap = { [sourceTableId]: targetTableId };

    const targetTable = {
      ...fakeTable(targetTableId, 'Tasks'),
      dbTableName: vi.fn(() => ok({ value: () => ok('bseTarget.target_tasks') })),
    };
    const tableMapper = {
      toDTO: vi.fn(() =>
        ok({
          fields: [
            { id: targetTextFieldId, type: 'singleLineText', dbFieldName: 'title' },
            {
              id: 'fldComputeddddddddd',
              type: 'formula',
              isComputed: true,
              dbFieldName: 'computed_col',
            },
            {
              id: targetLinkFieldId,
              type: 'link',
              dbFieldName: 'owner',
              options: {
                relationship: 'manyMany',
                foreignTableId: 'tbleeeeeeeeeeeeeeee',
                lookupFieldId: 'fldffffffffffffffff',
                fkHostTableName: 'bseTarget.junction_new',
                selfKeyName: '__fk_new_self',
                foreignKeyName: '__fk_new_foreign',
              },
            },
          ],
        })
      ),
    };
    const baseDataBulkCopier = {
      isSupported: vi.fn(async () => ok(true)),
      copyBaseData: vi.fn(
        async (
          _context: unknown,
          _plan: BaseDataBulkCopyPlan,
          onProgress?: (progress: BaseDataBulkCopyProgress) => void
        ) => {
          onProgress?.({ phase: 'table_data_start', processedRows: 0, totalRows: 3 });
          onProgress?.({
            phase: 'table_data_progress',
            tableId: targetTableId,
            tableName: 'Tasks',
            processedRows: 3,
            batchProcessedRows: 3,
            currentBatch: 1,
            totalRows: 3,
          });
          onProgress?.({ phase: 'table_data_done', processedRows: 3, totalRows: 3 });
          return ok({ recordsLength: 3 });
        }
      ),
    };
    const tableRecordRepository = {
      insertManyStream: vi.fn(async () => ok({ totalInserted: 0 })),
      updateManyStream: vi.fn(async () => ok({ totalUpdated: 0 })),
    };
    const computedFieldBackfillService = {
      executeSyncMany: vi.fn(async () => ok(undefined)),
    };
    const handler = createHandler({
      tableRecordRepository,
      tableMapper,
      baseDataBulkCopier,
      computedFieldBackfillService,
    });
    const records = vi.fn(async function* () {
      yield undefined as never;
    });
    const command = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          tables: [
            {
              id: sourceTableId,
              name: 'Tasks',
              fields: [
                { id: sourceTextFieldId, name: 'Title', type: 'singleLineText' },
                { id: sourceLinkFieldId, name: 'Owner', type: 'link' },
              ],
            },
          ],
        },
        records,
        sourceDbTableNameByTableId: { [sourceTableId]: 'bseSource.source_tasks' },
        sourceLinkFields: [
          {
            tableId: sourceTableId,
            fieldId: sourceLinkFieldId,
            fkHostTableName: 'bseSource.junction_old',
            selfKeyName: '__fk_old_self',
            foreignKeyName: '__fk_old_foreign',
          },
        ],
      },
      withRecords: true,
    })._unsafeUnwrap();

    vi.spyOn(
      handler as unknown as { createTables: (...args: unknown[]) => Promise<unknown> },
      'createTables'
    ).mockResolvedValue(
      ok({
        result: { tableIdMap, fieldIdMap, viewIdMap: {} },
        tablesBySourceId: new Map([[sourceTableId, targetTable]]),
      }) as never
    );

    const result = await handler.handle({} as never, command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      if (event.id === 'error') throw new Error(event.message);
      events.push(event);
    }

    expect(baseDataBulkCopier.copyBaseData).toHaveBeenCalledOnce();
    const plan = baseDataBulkCopier.copyBaseData.mock.calls[0]?.[1] as BaseDataBulkCopyPlan;
    expect(plan.tables).toEqual([
      expect.objectContaining({
        sourceTableId,
        targetTableId,
        sourceDbTableName: 'bseSource.source_tasks',
        targetDbTableName: 'bseTarget.target_tasks',
        excludedTargetColumns: ['computed_col'],
      }),
    ]);
    expect(plan.junctions).toEqual([
      {
        sourceJunctionDbTableName: 'bseSource.junction_old',
        targetJunctionDbTableName: 'bseTarget.junction_new',
        sourceSelfKeyName: '__fk_old_self',
        sourceForeignKeyName: '__fk_old_foreign',
        targetSelfKeyName: '__fk_new_self',
        targetForeignKeyName: '__fk_new_foreign',
      },
    ]);
    expect(tableRecordRepository.insertManyStream).not.toHaveBeenCalled();
    expect(records).not.toHaveBeenCalled();
    expect(computedFieldBackfillService.executeSyncMany).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({ phase: 'table_data_progress', processedRows: 3, totalRows: 3 })
    );
    expect(events).toContainEqual({
      id: 'done',
      baseId,
      tableIdMap,
      fieldIdMap,
      viewIdMap: {},
      recordsLength: 3,
      recordCopyMode: 'bulk',
    });
  });

  it('falls back to row streaming when the bulk copier reports the source unreachable', async () => {
    const sourceTableId = 'tblaaaaaaaaaaaaaaaa';
    const targetTableId = 'tblbbbbbbbbbbbbbbbb';
    const sourceTextFieldId = 'fldaaaaaaaaaaaaaaaa';
    const targetTextFieldId = 'fldbbbbbbbbbbbbbbbb';

    const targetTable = {
      ...fakeTable(targetTableId, 'Tasks'),
      dbTableName: vi.fn(() => ok({ value: () => ok('bseTarget.target_tasks') })),
      updateRecordsStream: vi.fn(function* () {
        yield ok([]);
      }),
    };
    const tableMapper = {
      toDTO: vi.fn(() =>
        ok({
          fields: [{ id: targetTextFieldId, type: 'singleLineText', dbFieldName: 'title' }],
        })
      ),
    };
    const baseDataBulkCopier = {
      isSupported: vi.fn(async () => ok(false)),
      copyBaseData: vi.fn(),
    };
    const tableRecordRepository = {
      insertManyStream: vi.fn(async (_context: unknown, _table: unknown, _batches: unknown) =>
        ok({ totalInserted: 1 })
      ),
      updateManyStream: vi.fn(async () => ok({ totalUpdated: 0 })),
    };
    const unitOfWork = {
      withTransaction: vi.fn((_context: unknown, callback: (tx: unknown) => Promise<unknown>) =>
        callback({ tx: true })
      ),
    };
    const pluginExecution = {
      guard: vi.fn(async () => ok(undefined)),
      beforePersist: vi.fn(async () => ok(undefined)),
      afterCommit: vi.fn(async () => undefined),
    };
    const recordWritePluginRunner = {
      prepare: vi.fn(async () => ok(pluginExecution)),
    };
    const handler = createHandler({
      tableRecordRepository,
      unitOfWork,
      recordWritePluginRunner,
      tableMapper,
      baseDataBulkCopier,
    });
    const records = vi.fn(async function* () {
      yield {
        recordId: 'recaaaaaaaaaaaaaaaa',
        fields: { [sourceTextFieldId]: 'Task A' },
      };
    });
    const command = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          tables: [
            {
              id: sourceTableId,
              name: 'Tasks',
              fields: [{ id: sourceTextFieldId, name: 'Title', type: 'singleLineText' }],
            },
          ],
        },
        records,
        sourceDbTableNameByTableId: { [sourceTableId]: 'bseSource.source_tasks' },
      },
      withRecords: true,
    })._unsafeUnwrap();

    vi.spyOn(
      handler as unknown as { createTables: (...args: unknown[]) => Promise<unknown> },
      'createTables'
    ).mockResolvedValue(
      ok({
        result: {
          tableIdMap: { [sourceTableId]: targetTableId },
          fieldIdMap: { [sourceTextFieldId]: targetTextFieldId },
          viewIdMap: {},
        },
        tablesBySourceId: new Map([[sourceTableId, targetTable]]),
      }) as never
    );

    const result = await handler.handle({} as never, command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      if (event.id === 'error') throw new Error(event.message);
      events.push(event);
    }

    expect(baseDataBulkCopier.isSupported).toHaveBeenCalledOnce();
    expect(baseDataBulkCopier.copyBaseData).not.toHaveBeenCalled();
    expect(records).toHaveBeenCalledWith(sourceTableId, { phase: 'insert' });
    expect(tableRecordRepository.insertManyStream).toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({ id: 'done', recordCopyMode: 'stream' })
    );
  });

  it('streams records when the source carries no physical table names', async () => {
    const sourceTableId = 'tblaaaaaaaaaaaaaaaa';
    const targetTableId = 'tblbbbbbbbbbbbbbbbb';
    const sourceTextFieldId = 'fldaaaaaaaaaaaaaaaa';
    const targetTextFieldId = 'fldbbbbbbbbbbbbbbbb';

    const targetTable = {
      ...fakeTable(targetTableId, 'Tasks'),
      updateRecordsStream: vi.fn(function* () {
        yield ok([]);
      }),
    };
    const baseDataBulkCopier = {
      isSupported: vi.fn(async () => ok(true)),
      copyBaseData: vi.fn(),
    };
    const tableRecordRepository = {
      insertManyStream: vi.fn(async () => ok({ totalInserted: 1 })),
      updateManyStream: vi.fn(async () => ok({ totalUpdated: 0 })),
    };
    const unitOfWork = {
      withTransaction: vi.fn((_context: unknown, callback: (tx: unknown) => Promise<unknown>) =>
        callback({ tx: true })
      ),
    };
    const pluginExecution = {
      guard: vi.fn(async () => ok(undefined)),
      beforePersist: vi.fn(async () => ok(undefined)),
      afterCommit: vi.fn(async () => undefined),
    };
    const recordWritePluginRunner = {
      prepare: vi.fn(async () => ok(pluginExecution)),
    };
    const handler = createHandler({
      tableRecordRepository,
      unitOfWork,
      recordWritePluginRunner,
      baseDataBulkCopier,
    });
    const records = vi.fn(async function* () {
      yield {
        recordId: 'recaaaaaaaaaaaaaaaa',
        fields: { [sourceTextFieldId]: 'Task A' },
      };
    });
    const command = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          tables: [
            {
              id: sourceTableId,
              name: 'Tasks',
              fields: [{ id: sourceTextFieldId, name: 'Title', type: 'singleLineText' }],
            },
          ],
        },
        records,
      },
      withRecords: true,
    })._unsafeUnwrap();

    vi.spyOn(
      handler as unknown as { createTables: (...args: unknown[]) => Promise<unknown> },
      'createTables'
    ).mockResolvedValue(
      ok({
        result: {
          tableIdMap: { [sourceTableId]: targetTableId },
          fieldIdMap: { [sourceTextFieldId]: targetTextFieldId },
          viewIdMap: {},
        },
        tablesBySourceId: new Map([[sourceTableId, targetTable]]),
      }) as never
    );

    const result = await handler.handle({} as never, command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      if (event.id === 'error') throw new Error(event.message);
      events.push(event);
    }

    expect(baseDataBulkCopier.isSupported).not.toHaveBeenCalled();
    expect(baseDataBulkCopier.copyBaseData).not.toHaveBeenCalled();
    expect(records).toHaveBeenCalledWith(sourceTableId, { phase: 'insert' });
    expect(events).toContainEqual(
      expect.objectContaining({ id: 'done', recordCopyMode: 'stream' })
    );
  });
});
