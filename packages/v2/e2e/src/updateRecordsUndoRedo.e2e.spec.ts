/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';
import {
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
  getViewId,
  listRecordIdsByViewOrder,
} from './undo-redo/shared/undoRedoE2eTestKit';

/**
 * The HTTP harness always executes with `windowId: 'e2e-window'`
 * (globalTestContext `createExecutionContext`) and no request header can clear
 * it, so this file can only assert windowed undo/redo. Windowless recording and
 * undo-redo replay need a separate PostgreSQL spec.
 */
describe('v2 updateRecords undo/redo (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('supports undo/redo for bulk updates targeted by recordIds', async () => {
    const table = await createBasicTable(ctx, 'Undo Redo Update Records');
    const tableId = table.id;
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');

    const [recordA, recordB, recordC] = await ctx.createRecords(tableId, [
      {
        fields: {
          [titleFieldId]: 'Alpha',
          [amountFieldId]: 1,
        },
      },
      {
        fields: {
          [titleFieldId]: 'Beta',
          [amountFieldId]: 2,
        },
      },
      {
        fields: {
          [titleFieldId]: 'Gamma',
          [amountFieldId]: 3,
        },
      },
    ]);

    const result = await ctx.updateRecords({
      tableId,
      fields: {
        [amountFieldId]: 99,
      },
      recordIds: [recordA.id, recordC.id],
    });

    expect(result.updatedCount).toBe(2);

    let records = await ctx.listRecords(tableId, { limit: 10 });
    let amountByTitle = new Map(
      records.map((record) => [record.fields[titleFieldId], record.fields[amountFieldId]])
    );
    expect(amountByTitle.get('Alpha')).toBe(99);
    expect(amountByTitle.get('Beta')).toBe(2);
    expect(amountByTitle.get('Gamma')).toBe(99);

    await executeUndo(ctx, tableId);

    records = await ctx.listRecords(tableId, { limit: 10 });
    amountByTitle = new Map(
      records.map((record) => [record.fields[titleFieldId], record.fields[amountFieldId]])
    );
    expect(amountByTitle.get('Alpha')).toBe(1);
    expect(amountByTitle.get('Beta')).toBe(2);
    expect(amountByTitle.get('Gamma')).toBe(3);

    await executeRedo(ctx, tableId);

    records = await ctx.listRecords(tableId, { limit: 10 });
    amountByTitle = new Map(
      records.map((record) => [record.fields[titleFieldId], record.fields[amountFieldId]])
    );
    expect(amountByTitle.get('Alpha')).toBe(99);
    expect(amountByTitle.get('Beta')).toBe(2);
    expect(amountByTitle.get('Gamma')).toBe(99);
    expect(recordB.id).toBeDefined();
  });

  it('undoes sparse explicit record updates with null restores', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Redo Update Records Explicit Sparse',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'singleLineText', name: 'Notes' },
        { type: 'singleSelect', name: 'Status', options: ['Open', 'Closed'] },
      ],
      views: [{ type: 'grid' }],
    });
    const tableId = table.id;
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const notesFieldId = findFieldId(table, 'Notes');
    const statusFieldId = findFieldId(table, 'Status');

    const [alpha, beta] = await ctx.createRecords(tableId, [
      {
        fields: {
          [titleFieldId]: 'Alpha',
          [amountFieldId]: 1,
          [notesFieldId]: 'alpha-note',
          [statusFieldId]: 'Open',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Beta',
          [amountFieldId]: 2,
          [notesFieldId]: 'beta-note',
          [statusFieldId]: 'Closed',
        },
      },
    ]);

    const loadRecord = async (recordId: string) => {
      const records = await ctx.listRecords(tableId, { limit: 10 });
      const record = records.find((item) => item.id === recordId);
      if (!record) {
        throw new Error(`Missing record ${recordId}`);
      }
      return record;
    };

    // Each row touches a different sparse set; untouched columns must survive.
    const result = await ctx.updateRecords({
      tableId,
      records: [
        { id: alpha.id, fields: { [amountFieldId]: null, [notesFieldId]: 'alpha-updated' } },
        { id: beta.id, fields: { [statusFieldId]: null } },
      ],
    });
    expect(result.updatedCount).toBe(2);

    let alphaRecord = await loadRecord(alpha.id);
    let betaRecord = await loadRecord(beta.id);
    expect(alphaRecord.fields[amountFieldId]).toBeNull();
    expect(alphaRecord.fields[notesFieldId]).toBe('alpha-updated');
    expect(alphaRecord.fields[statusFieldId]).toBe('Open');
    expect(alphaRecord.fields[titleFieldId]).toBe('Alpha');
    expect(betaRecord.fields[statusFieldId]).toBeNull();
    expect(betaRecord.fields[amountFieldId]).toBe(2);
    expect(betaRecord.fields[notesFieldId]).toBe('beta-note');
    expect(betaRecord.fields[titleFieldId]).toBe('Beta');

    await executeUndo(ctx, tableId);

    alphaRecord = await loadRecord(alpha.id);
    betaRecord = await loadRecord(beta.id);
    expect(alphaRecord.fields[amountFieldId]).toBe(1);
    expect(alphaRecord.fields[notesFieldId]).toBe('alpha-note');
    expect(alphaRecord.fields[statusFieldId]).toBe('Open');
    expect(betaRecord.fields[statusFieldId]).toBe('Closed');
    expect(betaRecord.fields[amountFieldId]).toBe(2);
    expect(betaRecord.fields[notesFieldId]).toBe('beta-note');

    await executeRedo(ctx, tableId);

    alphaRecord = await loadRecord(alpha.id);
    betaRecord = await loadRecord(beta.id);
    expect(alphaRecord.fields[amountFieldId]).toBeNull();
    expect(alphaRecord.fields[notesFieldId]).toBe('alpha-updated');
    expect(betaRecord.fields[statusFieldId]).toBeNull();
    expect(betaRecord.fields[amountFieldId]).toBe(2);
    expect(betaRecord.fields[notesFieldId]).toBe('beta-note');
  });

  it('undoes field update, row order and typecast select-option creation as one entry', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Redo Update Records Combined',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'singleSelect', name: 'Status', options: ['Open'] },
      ],
      views: [{ type: 'grid' }],
    });
    const tableId = table.id;
    const viewId = getViewId(table);
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const statusFieldId = findFieldId(table, 'Status');

    const [alpha, beta, gamma] = await ctx.createRecords(tableId, [
      { fields: { [titleFieldId]: 'Alpha', [amountFieldId]: 1, [statusFieldId]: 'Open' } },
      { fields: { [titleFieldId]: 'Beta', [amountFieldId]: 2, [statusFieldId]: 'Open' } },
      { fields: { [titleFieldId]: 'Gamma', [amountFieldId]: 3, [statusFieldId]: 'Open' } },
    ]);

    const choiceNames = async () => {
      const refreshed = await ctx.getTableById(tableId);
      const options = refreshed.fields.find((field) => field.id === statusFieldId)?.options as
        | { choices?: Array<{ name: string }> }
        | undefined;
      return (options?.choices ?? []).map((choice) => choice.name);
    };

    // One entry: field values, a typecast-created select choice and row order.
    const result = await ctx.updateRecords({
      tableId,
      typecast: true,
      records: [{ id: beta.id, fields: { [amountFieldId]: 20, [statusFieldId]: 'In Progress' } }],
      order: { viewId, anchorId: alpha.id, position: 'before' },
    });

    expect(result.updatedCount).toBe(1);

    expect(await listRecordIdsByViewOrder(ctx, tableId, viewId)).toEqual([
      beta.id,
      alpha.id,
      gamma.id,
    ]);
    expect(await choiceNames()).toEqual(['Open', 'In Progress']);
    let records = await ctx.listRecords(tableId, { limit: 10 });
    let betaRecord = records.find((item) => item.id === beta.id);
    expect(betaRecord?.fields[amountFieldId]).toBe(20);
    expect(betaRecord?.fields[statusFieldId]).toBe('In Progress');
    expect(betaRecord?.fields[titleFieldId]).toBe('Beta');
    expect(records.find((item) => item.id === alpha.id)?.fields[amountFieldId]).toBe(1);
    expect(records.find((item) => item.id === gamma.id)?.fields[amountFieldId]).toBe(3);

    await executeUndo(ctx, tableId);

    expect(await listRecordIdsByViewOrder(ctx, tableId, viewId)).toEqual([
      alpha.id,
      beta.id,
      gamma.id,
    ]);
    expect(await choiceNames()).toEqual(['Open']);
    records = await ctx.listRecords(tableId, { limit: 10 });
    betaRecord = records.find((item) => item.id === beta.id);
    expect(betaRecord?.fields[amountFieldId]).toBe(2);
    expect(betaRecord?.fields[statusFieldId]).toBe('Open');
    expect(records.find((item) => item.id === alpha.id)?.fields[amountFieldId]).toBe(1);

    await executeRedo(ctx, tableId);

    expect(await listRecordIdsByViewOrder(ctx, tableId, viewId)).toEqual([
      beta.id,
      alpha.id,
      gamma.id,
    ]);
    expect(await choiceNames()).toEqual(['Open', 'In Progress']);
    records = await ctx.listRecords(tableId, { limit: 10 });
    betaRecord = records.find((item) => item.id === beta.id);
    expect(betaRecord?.fields[amountFieldId]).toBe(20);
    expect(betaRecord?.fields[statusFieldId]).toBe('In Progress');
  });
});
