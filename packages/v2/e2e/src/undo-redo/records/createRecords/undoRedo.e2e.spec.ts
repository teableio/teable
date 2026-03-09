import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
} from '../../shared/undoRedoE2eTestKit';

describe('undo-redo/createRecords (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('undoes batch creation and restores the same records on redo', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E CreateRecords');
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');

    const records = await ctx.createRecords(table.id, [
      { fields: { [titleFieldId]: 'Alpha', [amountFieldId]: 1 } },
      { fields: { [titleFieldId]: 'Beta', [amountFieldId]: 2 } },
    ]);

    expect((await ctx.listRecords(table.id)).map((item) => item.id)).toEqual(
      records.map((record) => record.id)
    );

    await executeUndo(ctx, table.id);
    expect(await ctx.listRecords(table.id)).toHaveLength(0);

    await executeRedo(ctx, table.id);
    expect((await ctx.listRecords(table.id)).map((item) => item.id)).toEqual(
      records.map((record) => record.id)
    );
  });

  it('undoes select-option auto creation for batch create', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo E2E CreateRecords Select Options',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleSelect', name: 'Status', options: ['Open'] },
        { type: 'multipleSelect', name: 'Tags', options: ['Tag A'] },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = findFieldId(table, 'Title');
    const statusFieldId = findFieldId(table, 'Status');
    const tagsFieldId = findFieldId(table, 'Tags');

    const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: table.id,
        typecast: true,
        records: [
          {
            fields: {
              [titleFieldId]: 'Alpha',
              [statusFieldId]: 'In Progress',
              [tagsFieldId]: ['Tag A', 'Tag Z'],
            },
          },
        ],
      }),
    });
    expect(response.ok).toBe(true);
    const raw = await response.json();
    const createdIds = (raw.data.records as Array<{ id: string }>).map((record) => record.id);

    let updatedTable = await ctx.getTableById(table.id);
    expect(
      (
        (
          updatedTable.fields.find((field) => field.id === statusFieldId)?.options as {
            choices?: Array<{ name: string }>;
          }
        )?.choices ?? []
      ).map((choice) => choice.name)
    ).toEqual(['Open', 'In Progress']);

    await executeUndo(ctx, table.id);
    updatedTable = await ctx.getTableById(table.id);
    expect(
      (
        (
          updatedTable.fields.find((field) => field.id === statusFieldId)?.options as {
            choices?: Array<{ name: string }>;
          }
        )?.choices ?? []
      ).map((choice) => choice.name)
    ).toEqual(['Open']);
    expect(await ctx.listRecords(table.id)).toHaveLength(0);

    await executeRedo(ctx, table.id);
    updatedTable = await ctx.getTableById(table.id);
    expect(
      (
        (
          updatedTable.fields.find((field) => field.id === statusFieldId)?.options as {
            choices?: Array<{ name: string }>;
          }
        )?.choices ?? []
      ).map((choice) => choice.name)
    ).toEqual(['Open', 'In Progress']);
    expect((await ctx.listRecords(table.id)).map((item) => item.id)).toEqual(createdIds);
  });
});
