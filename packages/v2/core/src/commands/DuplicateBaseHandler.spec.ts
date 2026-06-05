import { ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { DuplicateBaseCommand } from './DuplicateBaseCommand';
import { DuplicateBaseHandler } from './DuplicateBaseHandler';

const baseId = `bse${'d'.repeat(16)}`;

const fakeTable = (id: string, name: string) => ({
  id: () => ({ toString: () => id }),
  name: () => ({ toString: () => name }),
});

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
    const handler = new DuplicateBaseHandler(
      {} as never,
      {} as never,
      tableRecordRepository as never,
      {} as never,
      unitOfWork as never
    );
    const sourceTextFieldId = 'fldaaaaaaaaaaaaaaaa';
    const sourceLinkFieldId = 'fldbbbbbbbbbbbbbbbb';
    const sourceTableId = 'tblaaaaaaaaaaaaaaaa';
    const recordId = 'recaaaaaaaaaaaaaaaa';
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
        records: async function* () {
          yield {
            recordId,
            fields: {
              [sourceTextFieldId]: 'Task A',
              [sourceLinkFieldId]: [{ id: 'recbbbbbbbbbbbbbbbb' }],
            },
          };
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
    expect(insertedFieldIds).toEqual([targetTextFieldId]);
    expect(linkUpdateItems).toHaveLength(1);
    expect(linkUpdateItems[0]?.fieldValues).toEqual(
      new Map([[targetLinkFieldId, [{ id: 'recbbbbbbbbbbbbbbbb' }]]])
    );
    expect(tableRecordRepository.insertManyStream).toHaveBeenCalledWith(
      expect.anything(),
      targetTable,
      expect.anything(),
      expect.objectContaining({ skipComputedUpdates: true })
    );
    expect(tableRecordRepository.updateManyStream).toHaveBeenCalledWith(
      expect.anything(),
      targetTable,
      expect.anything(),
      expect.objectContaining({ skipComputedUpdates: true, fillLinkTitles: true })
    );
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
    const handler = new DuplicateBaseHandler(
      {} as never,
      {} as never,
      tableRecordRepository as never,
      {} as never,
      unitOfWork as never
    );
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

  it('streams table structure progress with table counts', async () => {
    const handler = new DuplicateBaseHandler(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
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

  it('remaps aiConfig references when duplicating fields', async () => {
    const handler = new DuplicateBaseHandler(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
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
});
