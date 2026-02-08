/* eslint-disable @typescript-eslint/naming-convention */
import { ActorId, type ICommandBus, RedoCommand, UndoCommand, v2CoreTokens } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  getSharedTestContext,
  TEST_USER,
  type SharedTestContext,
} from './shared/globalTestContext';

const WINDOW_ID = 'e2e-window';

const buildContext = (actorId: string, windowId: string) => ({
  actorId: ActorId.create(actorId)._unsafeUnwrap(),
  windowId,
});

describe('v2 undo/redo complex flows (e2e)', () => {
  let ctx: SharedTestContext;
  let commandBus: ICommandBus;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    commandBus = ctx.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  });

  it('supports create/delete/update/paste undo redo sequence', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Redo Complex Flow',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });

    const tableId = table.id;
    const tableDetails = await ctx.getTableById(tableId);
    const viewId = tableDetails.views[0]!.id;
    const titleFieldId = table.fields.find((f) => f.name === 'Title')?.id ?? '';
    const amountFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';
    if (!titleFieldId || !amountFieldId) {
      throw new Error('Missing field ids for undo/redo flow test');
    }

    const record1 = await ctx.createRecord(tableId, {
      [titleFieldId]: 'Alpha',
      [amountFieldId]: 1,
    });
    const record2 = await ctx.createRecord(tableId, {
      [titleFieldId]: 'Beta',
      [amountFieldId]: 2,
    });

    await ctx.deleteRecord(tableId, record1.id);

    const context = buildContext(TEST_USER.id, WINDOW_ID);
    const undoCommand = UndoCommand.create({ tableId, windowId: WINDOW_ID })._unsafeUnwrap();
    const redoCommand = RedoCommand.create({ tableId, windowId: WINDOW_ID })._unsafeUnwrap();

    (await commandBus.execute(context, undoCommand))._unsafeUnwrap();

    let records = await ctx.listRecords(tableId, { limit: 10 });
    const restored = records.find((item) => item.id === record1.id);
    expect(restored?.fields[titleFieldId]).toBe('Alpha');
    expect(restored?.fields[amountFieldId]).toBe(1);

    (await commandBus.execute(context, redoCommand))._unsafeUnwrap();
    records = await ctx.listRecords(tableId, { limit: 10 });
    expect(records.find((item) => item.id === record1.id)).toBeUndefined();

    (await commandBus.execute(context, undoCommand))._unsafeUnwrap();
    records = await ctx.listRecords(tableId, { limit: 10 });
    expect(records.find((item) => item.id === record1.id)).toBeDefined();

    await ctx.updateRecord(tableId, record1.id, {
      [titleFieldId]: 'Alpha Updated',
      [amountFieldId]: 10,
    });

    records = await ctx.listRecords(tableId, { limit: 10 });
    const updated = records.find((item) => item.id === record1.id);
    expect(updated?.fields[titleFieldId]).toBe('Alpha Updated');
    expect(updated?.fields[amountFieldId]).toBe(10);

    (await commandBus.execute(context, undoCommand))._unsafeUnwrap();
    records = await ctx.listRecords(tableId, { limit: 10 });
    const updateUndone = records.find((item) => item.id === record1.id);
    expect(updateUndone?.fields[titleFieldId]).toBe('Alpha');
    expect(updateUndone?.fields[amountFieldId]).toBe(1);

    (await commandBus.execute(context, redoCommand))._unsafeUnwrap();
    records = await ctx.listRecords(tableId, { limit: 10 });
    const updateRedone = records.find((item) => item.id === record1.id);
    expect(updateRedone?.fields[titleFieldId]).toBe('Alpha Updated');
    expect(updateRedone?.fields[amountFieldId]).toBe(10);

    const beforePaste = await ctx.listRecords(tableId, { limit: 10 });
    expect(beforePaste.length).toBeGreaterThanOrEqual(2);
    const row0Before = beforePaste[0]!;
    const row1Before = beforePaste[1]!;

    await ctx.paste({
      tableId,
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

    const afterPaste = await ctx.listRecords(tableId, { limit: 20 });
    const row0After = afterPaste.find((item) => item.id === row0Before.id);
    const row1After = afterPaste.find((item) => item.id === row1Before.id);
    expect(row0After?.fields[titleFieldId]).toBe('Paste Row 0');
    expect(row1After?.fields[titleFieldId]).toBe('Paste Row 1');

    const newRecords = afterPaste.filter(
      (item) => !beforePaste.some((before) => before.id === item.id)
    );
    expect(newRecords).toHaveLength(1);
    const newRecordId = newRecords[0]!.id;
    expect(newRecords[0]!.fields[titleFieldId]).toBe('Paste Row 2');

    (await commandBus.execute(context, undoCommand))._unsafeUnwrap();
    const afterUndoPaste = await ctx.listRecords(tableId, { limit: 20 });
    const row0Undo = afterUndoPaste.find((item) => item.id === row0Before.id);
    const row1Undo = afterUndoPaste.find((item) => item.id === row1Before.id);
    expect(row0Undo?.fields[titleFieldId]).toBe(row0Before.fields[titleFieldId]);
    expect(row1Undo?.fields[titleFieldId]).toBe(row1Before.fields[titleFieldId]);
    expect(afterUndoPaste.find((item) => item.id === newRecordId)).toBeUndefined();

    (await commandBus.execute(context, redoCommand))._unsafeUnwrap();
    const afterRedoPaste = await ctx.listRecords(tableId, { limit: 20 });
    const row0Redo = afterRedoPaste.find((item) => item.id === row0Before.id);
    const row1Redo = afterRedoPaste.find((item) => item.id === row1Before.id);
    expect(row0Redo?.fields[titleFieldId]).toBe('Paste Row 0');
    expect(row1Redo?.fields[titleFieldId]).toBe('Paste Row 1');
    expect(afterRedoPaste.find((item) => item.id === newRecordId)).toBeDefined();
  });

  it('scopes undo/redo by actor, window, and table', async () => {
    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Redo Scope A',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });
    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Redo Scope B',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });

    const tableAId = tableA.id;
    const tableBId = tableB.id;
    const titleFieldA = tableA.fields.find((f) => f.name === 'Title')?.id ?? '';
    const amountFieldA = tableA.fields.find((f) => f.name === 'Amount')?.id ?? '';
    const titleFieldB = tableB.fields.find((f) => f.name === 'Title')?.id ?? '';
    const amountFieldB = tableB.fields.find((f) => f.name === 'Amount')?.id ?? '';
    if (!titleFieldA || !amountFieldA || !titleFieldB || !amountFieldB) {
      throw new Error('Missing field ids for scope test');
    }

    const recordA = await ctx.createRecord(tableAId, {
      [titleFieldA]: 'A1',
      [amountFieldA]: 1,
    });
    const recordB = await ctx.createRecord(tableBId, {
      [titleFieldB]: 'B1',
      [amountFieldB]: 2,
    });

    await ctx.updateRecord(tableAId, recordA.id, {
      [titleFieldA]: 'A2',
      [amountFieldA]: 10,
    });
    await ctx.updateRecord(tableBId, recordB.id, {
      [titleFieldB]: 'B2',
      [amountFieldB]: 20,
    });

    const wrongWindowContext = buildContext(TEST_USER.id, 'other-window');
    const wrongActorContext = buildContext('usrOtherActor', WINDOW_ID);
    const correctContext = buildContext(TEST_USER.id, WINDOW_ID);

    const undoAOtherWindow = UndoCommand.create({
      tableId: tableAId,
      windowId: 'other-window',
    })._unsafeUnwrap();
    (await commandBus.execute(wrongWindowContext, undoAOtherWindow))._unsafeUnwrap();

    let recordsA = await ctx.listRecords(tableAId, { limit: 10 });
    expect(recordsA.find((item) => item.id === recordA.id)?.fields[titleFieldA]).toBe('A2');

    const undoAWrongActor = UndoCommand.create({
      tableId: tableAId,
      windowId: WINDOW_ID,
    })._unsafeUnwrap();
    (await commandBus.execute(wrongActorContext, undoAWrongActor))._unsafeUnwrap();

    recordsA = await ctx.listRecords(tableAId, { limit: 10 });
    expect(recordsA.find((item) => item.id === recordA.id)?.fields[titleFieldA]).toBe('A2');

    const undoTableB = UndoCommand.create({
      tableId: tableBId,
      windowId: WINDOW_ID,
    })._unsafeUnwrap();
    (await commandBus.execute(correctContext, undoTableB))._unsafeUnwrap();

    const recordsBAfter = await ctx.listRecords(tableBId, { limit: 10 });
    expect(recordsBAfter.find((item) => item.id === recordB.id)?.fields[titleFieldB]).toBe('B1');

    recordsA = await ctx.listRecords(tableAId, { limit: 10 });
    expect(recordsA.find((item) => item.id === recordA.id)?.fields[titleFieldA]).toBe('A2');

    const undoTableA = UndoCommand.create({
      tableId: tableAId,
      windowId: WINDOW_ID,
    })._unsafeUnwrap();
    (await commandBus.execute(correctContext, undoTableA))._unsafeUnwrap();

    recordsA = await ctx.listRecords(tableAId, { limit: 10 });
    expect(recordsA.find((item) => item.id === recordA.id)?.fields[titleFieldA]).toBe('A1');
  });
});
