/* eslint-disable @typescript-eslint/naming-convention */
import { ActorId, type ICommandBus, RedoCommand, UndoCommand, v2CoreTokens } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  getSharedTestContext,
  TEST_USER,
  type SharedTestContext,
} from './shared/globalTestContext';

const WINDOW_ID = 'e2e-window';

describe('v2 updateRecord undo/redo (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let textFieldId: string;
  let numberFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Redo Update Record',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });

    tableId = table.id;
    textFieldId = table.fields.find((f) => f.name === 'Title')?.id ?? '';
    numberFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';
    if (!textFieldId || !numberFieldId) {
      throw new Error('Missing field ids for undo/redo test');
    }
  });

  it('records update and supports undo/redo', async () => {
    const record = await ctx.createRecord(tableId, {
      [textFieldId]: 'Original',
      [numberFieldId]: 10,
    });

    await ctx.updateRecord(tableId, record.id, {
      [textFieldId]: 'Updated',
      [numberFieldId]: 99,
    });

    const updatedRecords = await ctx.listRecords(tableId, { limit: 10 });
    const updated = updatedRecords.find((item) => item.id === record.id);
    expect(updated?.fields[textFieldId]).toBe('Updated');
    expect(updated?.fields[numberFieldId]).toBe(99);

    const commandBus = ctx.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const actorId = ActorId.create(TEST_USER.id)._unsafeUnwrap();
    const context = { actorId, windowId: WINDOW_ID };

    const undoCommand = UndoCommand.create({ tableId, windowId: WINDOW_ID })._unsafeUnwrap();
    const undoResult = await commandBus.execute(context, undoCommand);
    undoResult._unsafeUnwrap();

    const undoneRecords = await ctx.listRecords(tableId, { limit: 10 });
    const undone = undoneRecords.find((item) => item.id === record.id);
    expect(undone?.fields[textFieldId]).toBe('Original');
    expect(undone?.fields[numberFieldId]).toBe(10);

    const redoCommand = RedoCommand.create({ tableId, windowId: WINDOW_ID })._unsafeUnwrap();
    const redoResult = await commandBus.execute(context, redoCommand);
    redoResult._unsafeUnwrap();

    const redoneRecords = await ctx.listRecords(tableId, { limit: 10 });
    const redone = redoneRecords.find((item) => item.id === record.id);
    expect(redone?.fields[textFieldId]).toBe('Updated');
    expect(redone?.fields[numberFieldId]).toBe(99);
  });
});
