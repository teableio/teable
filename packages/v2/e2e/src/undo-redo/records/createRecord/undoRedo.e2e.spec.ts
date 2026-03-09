import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
} from '../../shared/undoRedoE2eTestKit';

describe('undo-redo/createRecord (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('undoes record creation and redoes it back to the created state', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E CreateRecord');
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');

    const record = await ctx.createRecord(table.id, {
      [titleFieldId]: 'Alpha',
      [amountFieldId]: 42,
    });
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === record.id)?.fields[amountFieldId]
    ).toBe(42);

    await executeUndo(ctx, table.id);
    expect((await ctx.listRecords(table.id)).find((item) => item.id === record.id)).toBeUndefined();

    await executeRedo(ctx, table.id);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === record.id)?.fields[amountFieldId]
    ).toBe(42);
  });

  it('undoes select-option auto creation together with create record', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo E2E CreateRecord Select Options',
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

    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: table.id,
        typecast: true,
        fields: {
          [titleFieldId]: 'Auto Options',
          [statusFieldId]: 'In Progress',
          [tagsFieldId]: ['Tag A', 'Tag Z'],
        },
      }),
    });
    expect(response.ok).toBe(true);
    const raw = await response.json();
    const record = raw.data.record as { id: string };

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
    expect((await ctx.listRecords(table.id)).find((item) => item.id === record.id)).toBeUndefined();

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
    const redone = (await ctx.listRecords(table.id)).find((item) => item.id === record.id);
    expect(redone?.fields[statusFieldId]).toBe('In Progress');
    expect(redone?.fields[tagsFieldId]).toEqual(['Tag A', 'Tag Z']);
  });
});
