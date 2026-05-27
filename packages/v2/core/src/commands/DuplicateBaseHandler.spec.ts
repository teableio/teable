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
