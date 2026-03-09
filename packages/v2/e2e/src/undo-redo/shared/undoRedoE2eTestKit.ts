/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  RedoCommand,
  Table as TableAggregate,
  UndoCommand,
  v2CoreTokens,
  type ICommandBus,
  type ITableRepository,
} from '@teable/v2-core';
import { sql } from 'kysely';

import { TEST_USER, type SharedTestContext } from '../../shared/globalTestContext';

export const E2E_UNDO_WINDOW_ID = 'e2e-window';

export const buildUndoRedoContext = (windowId = E2E_UNDO_WINDOW_ID) => ({
  actorId: ActorId.create(TEST_USER.id)._unsafeUnwrap(),
  windowId,
});

export const getCommandBus = (ctx: SharedTestContext) =>
  ctx.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);

export const executeUndo = async (
  ctx: SharedTestContext,
  tableId: string,
  windowId = E2E_UNDO_WINDOW_ID
) => {
  const result = await getCommandBus(ctx).execute(
    buildUndoRedoContext(windowId),
    UndoCommand.create({ tableId, windowId })._unsafeUnwrap()
  );
  if (result.isErr()) {
    throw new Error(`Undo failed: ${result.error.message}`);
  }
  return result.value;
};

export const executeRedo = async (
  ctx: SharedTestContext,
  tableId: string,
  windowId = E2E_UNDO_WINDOW_ID
) => {
  const result = await getCommandBus(ctx).execute(
    buildUndoRedoContext(windowId),
    RedoCommand.create({ tableId, windowId })._unsafeUnwrap()
  );
  if (result.isErr()) {
    throw new Error(`Redo failed: ${result.error.message}`);
  }
  return result.value;
};

export const createBasicTable = async (ctx: SharedTestContext, name: string) =>
  ctx.createTable({
    baseId: ctx.baseId,
    name,
    fields: [
      { type: 'singleLineText', name: 'Title', isPrimary: true },
      { type: 'number', name: 'Amount' },
    ],
    views: [{ type: 'grid' }],
  });

export const findFieldId = (
  table: { fields: Array<{ id: string; name: string }> },
  name: string
) => {
  const fieldId = table.fields.find((field) => field.name === name)?.id;
  if (!fieldId) {
    throw new Error(`Missing field ${name}`);
  }
  return fieldId;
};

export const getViewId = (table: { views: Array<{ id: string }> }) => {
  const viewId = table.views[0]?.id;
  if (!viewId) {
    throw new Error('Missing default view');
  }
  return viewId;
};

export const reorderRecords = async (
  ctx: SharedTestContext,
  payload: {
    tableId: string;
    recordIds: string[];
    order: { viewId: string; anchorId: string; position: 'before' | 'after' };
  }
) => {
  const response = await fetch(`${ctx.baseUrl}/tables/reorderRecords`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to reorder records: ${await response.text()}`);
  }
  return response.json();
};

export const listRecordIdsByViewOrder = async (
  ctx: SharedTestContext,
  tableId: string,
  viewId: string
) => {
  const fullTableName = `${ctx.baseId}.${tableId}`;
  const result = await sql<{ __id: string }>`
    SELECT __id
    FROM ${sql.table(fullTableName)}
    ORDER BY ${sql.ref(`__row_${viewId}`)} ASC
  `.execute(ctx.testContainer.db);
  return result.rows.map((row) => row.__id);
};

export const loadTable = async (ctx: SharedTestContext, tableId: string) => {
  const tableRepository = ctx.testContainer.container.resolve<ITableRepository>(
    v2CoreTokens.tableRepository
  );
  const spec = TableAggregate.specs().byId(tableId).build()._unsafeUnwrap();
  return (await tableRepository.findOne(buildUndoRedoContext(), spec))._unsafeUnwrap();
};

export const listFieldIdsByViewOrder = async (
  ctx: SharedTestContext,
  tableId: string,
  viewId: string
) => {
  const table = await loadTable(ctx, tableId);
  return table
    .getOrderedVisibleFieldIds(viewId)
    ._unsafeUnwrap()
    .map((fieldId) => fieldId.toString());
};
