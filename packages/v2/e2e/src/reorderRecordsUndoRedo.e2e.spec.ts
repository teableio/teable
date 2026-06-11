import {
  ActorId,
  type ICommandBus,
  RedoCommand,
  ReorderRecordsCommand,
  UndoCommand,
  v2CoreTokens,
} from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  getSharedTestContext,
  TEST_USER,
  type SharedTestContext,
} from './shared/globalTestContext';
import { sql } from 'kysely';

const WINDOW_ID = 'e2e-reorder-window';

const buildContext = (actorId: string, windowId: string) => ({
  actorId: ActorId.create(actorId)._unsafeUnwrap(),
  windowId,
});

describe('v2 undo/redo reorder records (e2e)', () => {
  let ctx: SharedTestContext;
  let commandBus: ICommandBus;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    commandBus = ctx.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  });

  const getRecordsInOrder = async (tableId: string, viewId: string) => {
    const orderColumnName = `__row_${viewId}`;
    const fullTableName = `${ctx.baseId}.${tableId}`;

    const result = await sql<{ __id: string }>`
      SELECT __id
      FROM ${sql.table(fullTableName)}
      ORDER BY ${sql.ref(orderColumnName)} ASC
    `.execute(ctx.testContainer.db);

    return result.rows.map((row) => row.__id);
  };

  it('undoes and redoes record reorder via the v2 undo store', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Redo Reorder',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const tableId = table.id;
    const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
    if (!titleFieldId) {
      throw new Error('Missing title field id');
    }

    const tableDetails = await ctx.getTableById(tableId);
    const viewId = tableDetails.views[0]?.id;
    if (!viewId) {
      throw new Error('Missing default view id');
    }

    const recordA = await ctx.createRecord(tableId, { [titleFieldId]: 'A' });
    const recordB = await ctx.createRecord(tableId, { [titleFieldId]: 'B' });
    const recordC = await ctx.createRecord(tableId, { [titleFieldId]: 'C' });

    const context = buildContext(TEST_USER.id, WINDOW_ID);
    const reorderCommand = ReorderRecordsCommand.create({
      tableId,
      recordIds: [recordC.id],
      order: {
        viewId,
        anchorId: recordA.id,
        position: 'before',
      },
    })._unsafeUnwrap();
    const undoCommand = UndoCommand.create({ tableId, windowId: WINDOW_ID })._unsafeUnwrap();
    const redoCommand = RedoCommand.create({ tableId, windowId: WINDOW_ID })._unsafeUnwrap();

    (await commandBus.execute(context, reorderCommand))._unsafeUnwrap();

    let orderedRecordIds = await getRecordsInOrder(tableId, viewId);
    expect(orderedRecordIds).toEqual([recordC.id, recordA.id, recordB.id]);

    (await commandBus.execute(context, undoCommand))._unsafeUnwrap();
    orderedRecordIds = await getRecordsInOrder(tableId, viewId);
    expect(orderedRecordIds).toEqual([recordA.id, recordB.id, recordC.id]);

    (await commandBus.execute(context, redoCommand))._unsafeUnwrap();
    orderedRecordIds = await getRecordsInOrder(tableId, viewId);
    expect(orderedRecordIds).toEqual([recordC.id, recordA.id, recordB.id]);
  });
});
