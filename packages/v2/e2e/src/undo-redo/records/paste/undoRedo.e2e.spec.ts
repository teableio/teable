import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
  getViewId,
} from '../../shared/undoRedoE2eTestKit';

describe('undo-redo/paste (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('undoes pasted updates and creations, then redoes them', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E Paste');
    const viewId = getViewId(table);
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const records = await ctx.createRecords(table.id, [
      { fields: { [titleFieldId]: 'Alpha', [amountFieldId]: 1 } },
      { fields: { [titleFieldId]: 'Beta', [amountFieldId]: 2 } },
    ]);

    const before = await ctx.listRecords(table.id, { limit: 20 });
    await ctx.paste({
      tableId: table.id,
      viewId,
      ranges: [
        [0, 0],
        [1, 2],
      ],
      content: [
        ['Paste Row 0', 100],
        ['Paste Row 1', 200],
        ['Paste Row 2', 300],
      ],
    });

    let listed = await ctx.listRecords(table.id, { limit: 20 });
    const created = listed.find((item) => !before.some((existing) => existing.id === item.id));
    expect(listed.find((item) => item.id === records[0]!.id)?.fields[titleFieldId]).toBe(
      'Paste Row 0'
    );
    expect(created?.fields[amountFieldId]).toBe(300);

    await executeUndo(ctx, table.id);
    listed = await ctx.listRecords(table.id, { limit: 20 });
    expect(listed.find((item) => item.id === records[0]!.id)?.fields[titleFieldId]).toBe('Alpha');
    expect(created && listed.find((item) => item.id === created.id)).toBeUndefined();

    await executeRedo(ctx, table.id);
    listed = await ctx.listRecords(table.id, { limit: 20 });
    expect(listed.find((item) => item.id === records[0]!.id)?.fields[titleFieldId]).toBe(
      'Paste Row 0'
    );
    expect(created && listed.find((item) => item.id === created.id)?.fields[amountFieldId]).toBe(
      300
    );
  });

  it('undoes auto-created linked rows together with the host-table paste changes, then redoes both tables', async () => {
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo E2E Paste Link Auto Create Foreign',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const foreignPrimaryFieldId = findFieldId(foreignTable, 'Title');

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo E2E Paste Link Auto Create Host',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          name: 'Related',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const hostViewId = getViewId(hostTable);
    const hostTitleFieldId = findFieldId(hostTable, 'Title');
    const hostLinkFieldId = findFieldId(hostTable, 'Related');

    const existingHostRows = await ctx.createRecords(hostTable.id, [
      { fields: { [hostTitleFieldId]: 'Alpha' } },
      { fields: { [hostTitleFieldId]: 'Beta' } },
    ]);
    const beforeHostRecords = await ctx.listRecords(hostTable.id, { limit: 20 });
    const beforeForeignRecords = await ctx.listRecords(foreignTable.id, { limit: 20 });
    const missingTitle = `auto_link_${hostTable.id}`;

    await ctx.paste({
      tableId: hostTable.id,
      viewId: hostViewId,
      typecast: true,
      ranges: [
        [0, 0],
        [1, 2],
      ],
      content: [
        ['Alpha Updated', missingTitle],
        ['Beta Updated', missingTitle],
        ['Gamma Created', missingTitle],
      ],
    });

    let hostRecords = await ctx.listRecords(hostTable.id, { limit: 20 });
    let foreignRecords = await ctx.listRecords(foreignTable.id, { limit: 20 });
    const createdForeignRow = foreignRecords.find(
      (record) => record.fields[foreignPrimaryFieldId] === missingTitle
    );
    const createdHostRow = hostRecords.find(
      (record) => !beforeHostRecords.some((existing) => existing.id === record.id)
    );

    expect(createdForeignRow).toBeDefined();
    expect(foreignRecords).toHaveLength(beforeForeignRecords.length + 1);
    expect(hostRecords).toHaveLength(beforeHostRecords.length + 1);
    expect(
      hostRecords.find((record) => record.id === existingHostRows[0]!.id)?.fields[hostTitleFieldId]
    ).toBe('Alpha Updated');
    expect(
      hostRecords.find((record) => record.id === existingHostRows[1]!.id)?.fields[hostTitleFieldId]
    ).toBe('Beta Updated');
    expect(createdHostRow?.fields[hostTitleFieldId]).toBe('Gamma Created');
    expect(
      hostRecords.find((record) => record.id === existingHostRows[0]!.id)?.fields[hostLinkFieldId]
    ).toEqual([{ id: createdForeignRow!.id, title: missingTitle }]);
    expect(
      hostRecords.find((record) => record.id === existingHostRows[1]!.id)?.fields[hostLinkFieldId]
    ).toEqual([{ id: createdForeignRow!.id, title: missingTitle }]);
    expect(createdHostRow?.fields[hostLinkFieldId]).toEqual([
      { id: createdForeignRow!.id, title: missingTitle },
    ]);

    await executeUndo(ctx, hostTable.id);
    hostRecords = await ctx.listRecords(hostTable.id, { limit: 20 });
    foreignRecords = await ctx.listRecords(foreignTable.id, { limit: 20 });

    expect(hostRecords).toHaveLength(beforeHostRecords.length);
    expect(
      hostRecords.find((record) => record.id === existingHostRows[0]!.id)?.fields[hostTitleFieldId]
    ).toBe('Alpha');
    expect(
      hostRecords.find((record) => record.id === existingHostRows[1]!.id)?.fields[hostTitleFieldId]
    ).toBe('Beta');
    expect(
      hostRecords.find((record) => record.id === existingHostRows[0]!.id)?.fields[hostLinkFieldId]
    ).toBeNull();
    expect(
      hostRecords.find((record) => record.id === existingHostRows[1]!.id)?.fields[hostLinkFieldId]
    ).toBeNull();
    expect(createdHostRow && hostRecords.find((record) => record.id === createdHostRow.id)).toBe(
      undefined
    );
    expect(foreignRecords).toHaveLength(beforeForeignRecords.length);
    expect(foreignRecords.find((record) => record.id === createdForeignRow!.id)).toBeUndefined();

    await executeRedo(ctx, hostTable.id);
    hostRecords = await ctx.listRecords(hostTable.id, { limit: 20 });
    foreignRecords = await ctx.listRecords(foreignTable.id, { limit: 20 });
    const redoneForeignRow = foreignRecords.find((record) => record.id === createdForeignRow!.id);

    expect(redoneForeignRow?.fields[foreignPrimaryFieldId]).toBe(missingTitle);
    expect(hostRecords).toHaveLength(beforeHostRecords.length + 1);
    expect(
      hostRecords.find((record) => record.id === existingHostRows[0]!.id)?.fields[hostTitleFieldId]
    ).toBe('Alpha Updated');
    expect(
      hostRecords.find((record) => record.id === existingHostRows[1]!.id)?.fields[hostTitleFieldId]
    ).toBe('Beta Updated');
    expect(
      hostRecords.find((record) => record.id === existingHostRows[0]!.id)?.fields[hostLinkFieldId]
    ).toEqual([{ id: createdForeignRow!.id, title: missingTitle }]);
    expect(
      hostRecords.find((record) => record.id === existingHostRows[1]!.id)?.fields[hostLinkFieldId]
    ).toEqual([{ id: createdForeignRow!.id, title: missingTitle }]);
    expect(
      hostRecords.find((record) => record.id === createdHostRow!.id)?.fields[hostTitleFieldId]
    ).toBe('Gamma Created');
    expect(
      hostRecords.find((record) => record.id === createdHostRow!.id)?.fields[hostLinkFieldId]
    ).toEqual([{ id: createdForeignRow!.id, title: missingTitle }]);
  });

  it('undoes select-option schema side effects produced by paste', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo E2E Paste Select Options',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleSelect', name: 'Status', options: ['Open'] },
        { type: 'multipleSelect', name: 'Tags', options: ['Tag A'] },
      ],
      views: [{ type: 'grid' }],
    });
    const viewId = getViewId(table);
    const titleFieldId = findFieldId(table, 'Title');
    const statusFieldId = findFieldId(table, 'Status');
    const tagsFieldId = findFieldId(table, 'Tags');

    const existing = await ctx.createRecord(table.id, {
      [titleFieldId]: 'Alpha',
      [statusFieldId]: 'Open',
      [tagsFieldId]: ['Tag A'],
    });

    await ctx.paste({
      tableId: table.id,
      viewId,
      typecast: true,
      ranges: [
        [0, 0],
        [2, 1],
      ],
      content: [
        ['Paste Row 0', 'In Progress', 'Tag A, Tag Z'],
        ['Paste Row 1', 'Open', 'Tag A'],
      ],
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
    let listed = await ctx.listRecords(table.id, { limit: 20 });
    expect(listed.find((item) => item.id === existing.id)?.fields[statusFieldId]).toBe('Open');
    expect(listed).toHaveLength(1);

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
    listed = await ctx.listRecords(table.id, { limit: 20 });
    expect(listed.find((item) => item.id === existing.id)?.fields[statusFieldId]).toBe(
      'In Progress'
    );
    expect(listed).toHaveLength(2);
  });
});
