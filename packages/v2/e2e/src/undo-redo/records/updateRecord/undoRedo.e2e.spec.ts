import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
} from '../../shared/undoRedoE2eTestKit';

describe('undo-redo/updateRecord (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('undoes updated cell values and redoes them', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E UpdateRecord');
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const record = await ctx.createRecord(table.id, {
      [titleFieldId]: 'Original',
      [amountFieldId]: 10,
    });

    await ctx.updateRecord(table.id, record.id, {
      [titleFieldId]: 'Updated',
      [amountFieldId]: 99,
    });
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === record.id)?.fields[titleFieldId]
    ).toBe('Updated');

    await executeUndo(ctx, table.id);
    const undone = (await ctx.listRecords(table.id)).find((item) => item.id === record.id);
    expect(undone?.fields[titleFieldId]).toBe('Original');
    expect(undone?.fields[amountFieldId]).toBe(10);

    await executeRedo(ctx, table.id);
    const redone = (await ctx.listRecords(table.id)).find((item) => item.id === record.id);
    expect(redone?.fields[titleFieldId]).toBe('Updated');
    expect(redone?.fields[amountFieldId]).toBe(99);
  });

  it('undoes select-option schema side effects around update record', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo E2E UpdateRecord Select Options',
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
    const record = await ctx.createRecord(table.id, {
      [titleFieldId]: 'Original',
      [statusFieldId]: 'Open',
      [tagsFieldId]: ['Tag A'],
    });

    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: table.id,
        recordId: record.id,
        typecast: true,
        fields: {
          [statusFieldId]: 'In Progress',
          [tagsFieldId]: ['Tag A', 'Tag Z'],
        },
      }),
    });
    expect(response.ok).toBe(true);

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
    let updated = (await ctx.listRecords(table.id)).find((item) => item.id === record.id);
    expect(updated?.fields[statusFieldId]).toBe('Open');
    expect(updated?.fields[tagsFieldId]).toEqual(['Tag A']);

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
    updated = (await ctx.listRecords(table.id)).find((item) => item.id === record.id);
    expect(updated?.fields[statusFieldId]).toBe('In Progress');
    expect(updated?.fields[tagsFieldId]).toEqual(['Tag A', 'Tag Z']);
  });
});
