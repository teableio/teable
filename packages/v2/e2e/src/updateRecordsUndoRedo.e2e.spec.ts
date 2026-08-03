/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';
import {
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
} from './undo-redo/shared/undoRedoE2eTestKit';

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
});
