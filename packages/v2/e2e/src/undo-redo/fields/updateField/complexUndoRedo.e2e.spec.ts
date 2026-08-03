import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import { executeRedo, executeUndo } from '../../shared/undoRedoE2eTestKit';

describe('undo-redo/updateField complex cases (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('undoes and redoes select option rename via update field', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo E2E UpdateField Option Rename',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [{ id: 'opt-open', name: 'Open', color: 'blueBright' }],
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    const statusField = table.fields.find((field) => field.name === 'Status');
    const statusFieldId = statusField?.id ?? '';
    const openChoice = (
      statusField?.options as { choices?: Array<{ id: string; name: string; color: string }> }
    )?.choices?.[0];
    if (!openChoice) {
      throw new Error('Missing initial status option');
    }

    const record = await ctx.createRecord(table.id, {
      [titleFieldId]: 'R1',
      [statusFieldId]: 'Open',
    });

    await ctx.updateField({
      baseId: ctx.baseId,
      tableId: table.id,
      fieldId: statusFieldId,
      field: {
        options: {
          choices: [{ ...openChoice, name: 'In Progress' }],
        },
      },
    });

    let updatedTable = await ctx.getTableById(table.id);
    expect(
      (
        (
          updatedTable.fields.find((field) => field.id === statusFieldId)?.options as {
            choices?: Array<{ name: string }>;
          }
        )?.choices ?? []
      ).map((choice) => choice.name)
    ).toEqual(['In Progress']);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === record.id)?.fields[statusFieldId]
    ).toBe('In Progress');

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
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === record.id)?.fields[statusFieldId]
    ).toBe('Open');

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
    ).toEqual(['In Progress']);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === record.id)?.fields[statusFieldId]
    ).toBe('In Progress');
  });

  it('undoes and redoes field type conversion with multiple record values', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo E2E UpdateField Type Conversion',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    const scoreFieldId = `fld${'s'.repeat(16)}`;

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        id: scoreFieldId,
        type: 'singleLineText',
        name: 'Score',
      },
    });

    const records = await Promise.all([
      ctx.createRecord(table.id, {
        [titleFieldId]: 'R1',
        [scoreFieldId]: '42',
      }),
      ctx.createRecord(table.id, {
        [titleFieldId]: 'R2',
        [scoreFieldId]: '7',
      }),
      ctx.createRecord(table.id, {
        [titleFieldId]: 'R3',
        [scoreFieldId]: '100',
      }),
    ]);

    await ctx.updateField({
      baseId: ctx.baseId,
      tableId: table.id,
      fieldId: scoreFieldId,
      field: { type: 'number' },
    });

    let listedRecords = await ctx.listRecords(table.id);
    expect(
      records.map(
        (record) => listedRecords.find((item) => item.id === record.id)?.fields[scoreFieldId]
      )
    ).toEqual([42, 7, 100]);

    await executeUndo(ctx, table.id);
    let updatedTable = await ctx.getTableById(table.id);
    expect(updatedTable.fields.find((field) => field.id === scoreFieldId)?.type).toBe(
      'singleLineText'
    );
    listedRecords = await ctx.listRecords(table.id);
    expect(
      records.map(
        (record) => listedRecords.find((item) => item.id === record.id)?.fields[scoreFieldId]
      )
    ).toEqual(['42', '7', '100']);

    await executeRedo(ctx, table.id);
    updatedTable = await ctx.getTableById(table.id);
    expect(updatedTable.fields.find((field) => field.id === scoreFieldId)?.type).toBe('number');
    listedRecords = await ctx.listRecords(table.id);
    expect(
      records.map(
        (record) => listedRecords.find((item) => item.id === record.id)?.fields[scoreFieldId]
      )
    ).toEqual([42, 7, 100]);
  });
});
