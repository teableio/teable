import {
  getViewErrorResponseSchema,
  getViewOkResponseSchema,
  listViewsErrorResponseSchema,
  listViewsOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import {
  ActorId,
  DeleteViewCommand,
  type DeleteViewResult,
  type ICommandBus,
  v2CoreTokens,
} from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getSharedTestContext,
  TEST_USER,
  type SharedTestContext,
} from './shared/globalTestContext';

describe('v2 http View read contracts (e2e)', () => {
  let ctx: SharedTestContext;
  let client: ReturnType<typeof createV2HttpClient>;
  let tableId: string;
  let foreignTableId: string;
  let primaryFieldId: string;
  let statusFieldId: string;
  let seedViewId: string;
  let richViewId: string;
  let kanbanViewId: string;
  let formViewId: string;
  let disposableViewId: string;
  let foreignViewId: string;

  const getViewRaw = async (targetTableId: string, viewId: string) => {
    const search = new URLSearchParams({ tableId: targetTableId, viewId });
    const response = await fetch(`${ctx.baseUrl}/tables/getView?${search.toString()}`);
    return { response, body: await response.json() };
  };

  const listViewsRaw = async (targetTableId: string) => {
    const search = new URLSearchParams({ tableId: targetTableId });
    const response = await fetch(`${ctx.baseUrl}/tables/listViews?${search.toString()}`);
    return { response, body: await response.json() };
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'View Read Contract',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { id: 'choTodo', name: 'Todo', color: 'blue' },
              { id: 'choDone', name: 'Done', color: 'green' },
            ],
          },
        },
      ],
      views: [{ type: 'grid', name: 'Seed' }],
    });
    tableId = table.id;
    primaryFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
    seedViewId = table.views[0]?.id ?? '';
    if (!primaryFieldId || !statusFieldId || !seedViewId) {
      throw new Error('View read contract fixture is incomplete');
    }

    const richResult = await client.tables.createView({
      tableId,
      view: {
        type: 'grid',
        name: 'Planning',
        description: 'Planning details',
        columnMeta: {
          [primaryFieldId]: { width: 240 },
        },
        options: { rowHeight: 'short', frozenColumnCount: 1 },
        sourceFilter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: primaryFieldId,
              operator: 'LIKE',
              isSymbol: true,
              value: 'alpha',
            },
          ],
        },
        sort: [{ fieldId: primaryFieldId, order: 'asc' }],
        group: [{ fieldId: statusFieldId, order: 'desc' }],
        manualSort: false,
        isLocked: true,
        enableShare: true,
        shareMeta: { allowCopy: false, includeRecords: true, password: 'secret' },
      },
    });
    if (!richResult.ok) throw new Error(richResult.error.message);
    richViewId = richResult.data.viewId;

    const kanbanResult = await client.tables.createView({
      tableId,
      view: {
        type: 'kanban',
        name: 'Board',
        options: { stackFieldId: statusFieldId, isEmptyStackHidden: true },
      },
    });
    if (!kanbanResult.ok) throw new Error(kanbanResult.error.message);
    kanbanViewId = kanbanResult.data.viewId;

    const formResult = await client.tables.createView({
      tableId,
      view: {
        type: 'form',
        name: 'Intake',
        options: { submitLabel: 'Send' },
      },
    });
    if (!formResult.ok) throw new Error(formResult.error.message);
    formViewId = formResult.data.viewId;

    const disposableResult = await client.tables.createView({
      tableId,
      view: { type: 'gallery', name: 'Disposable' },
    });
    if (!disposableResult.ok) throw new Error(disposableResult.error.message);
    disposableViewId = disposableResult.data.viewId;

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Foreign View Read Contract',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid', name: 'Foreign' }],
    });
    foreignTableId = foreignTable.id;
    foreignViewId = foreignTable.views[0]?.id ?? '';
    if (!foreignViewId) throw new Error('Foreign View fixture is incomplete');
  });

  afterAll(async () => {
    if (ctx && tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    if (ctx && foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
  });

  it('gets a rich View child through the Table aggregate projection', async () => {
    const { response, body } = await getViewRaw(tableId, richViewId);

    expect(response.status, JSON.stringify(body)).toBe(200);
    const parsed = getViewOkResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;

    expect(parsed.data.data.view).toMatchObject({
      id: richViewId,
      name: 'Planning',
      type: 'grid',
      description: 'Planning details',
      options: { rowHeight: 'short', frozenColumnCount: 1 },
      sort: {
        sortObjs: [{ fieldId: primaryFieldId, order: 'asc' }],
        manualSort: false,
      },
      group: [{ fieldId: statusFieldId, order: 'desc' }],
      isLocked: true,
      enableShare: true,
      shareMeta: { allowCopy: false, includeRecords: true, password: 'secret' },
      createdBy: TEST_USER.id,
    });
    expect(parsed.data.data.view.createdTime).toBeTruthy();
    expect(parsed.data.data.view.columnMeta[primaryFieldId]).toMatchObject({
      order: 0,
      width: 240,
    });
  });

  it('lists every View child in aggregate order with subtype-specific options', async () => {
    const { response, body } = await listViewsRaw(tableId);

    expect(response.status, JSON.stringify(body)).toBe(200);
    const parsed = listViewsOkResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;

    expect(parsed.data.data.views.map((view) => view.id)).toEqual([
      seedViewId,
      richViewId,
      kanbanViewId,
      formViewId,
      disposableViewId,
    ]);
    expect(parsed.data.data.views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: kanbanViewId,
          type: 'kanban',
          options: { stackFieldId: statusFieldId, isEmptyStackHidden: true },
        }),
        expect.objectContaining({
          id: formViewId,
          type: 'form',
          options: { submitLabel: 'Send' },
        }),
      ])
    );
  });

  it('supports typed get/list clients and keeps projected results in aggregate order', async () => {
    const getResult = await client.tables.getView({ tableId, viewId: formViewId });
    expect(getResult).toMatchObject({
      ok: true,
      data: { view: { id: formViewId, name: 'Intake', type: 'form' } },
    });

    const listResult = await client.tables.listViews({
      tableId,
      viewIds: [formViewId, richViewId, formViewId],
    });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.data.views.map((view) => view.id)).toEqual([richViewId, formViewId]);
  });

  it('returns an empty typed projection for a View outside the requested Table scope', async () => {
    const result = await client.tables.listViews({ tableId, viewIds: [foreignViewId] });

    expect(result).toEqual({ ok: true, data: { views: [] } });
  });

  it('rejects malformed Table and View identifiers at the contract boundary', async () => {
    const invalidGet = await getViewRaw('invalid', 'invalid');
    expect(invalidGet.response.status).toBe(400);
    expect(getViewErrorResponseSchema.safeParse(invalidGet.body).success).toBe(true);

    const response = await fetch(
      `${ctx.baseUrl}/tables/listViews?${new URLSearchParams({
        tableId,
        viewIds: 'invalid',
      }).toString()}`
    );
    expect(response.status).toBe(400);
    expect(listViewsErrorResponseSchema.safeParse(await response.json()).success).toBe(true);
  });

  it('does not resolve a View child through the wrong Table aggregate', async () => {
    const { response, body } = await getViewRaw(tableId, foreignViewId);

    expect(response.status).toBe(404);
    const parsed = getViewErrorResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.ok) return;
    expect(parsed.data.error.code).toBe('view.not_found');
  });

  it('maps missing View and Table aggregates to their query-specific errors', async () => {
    const missingView = await getViewRaw(tableId, `viw${'z'.repeat(16)}`);
    expect(missingView.response.status).toBe(404);
    const parsedView = getViewErrorResponseSchema.safeParse(missingView.body);
    expect(parsedView.success).toBe(true);
    if (parsedView.success && !parsedView.data.ok) {
      expect(parsedView.data.error.code).toBe('view.not_found');
    }

    const missingTable = await listViewsRaw(`tbl${'z'.repeat(16)}`);
    expect(missingTable.response.status).toBe(404);
    const parsedTable = listViewsErrorResponseSchema.safeParse(missingTable.body);
    expect(parsedTable.success).toBe(true);
    if (parsedTable.success && !parsedTable.data.ok) {
      expect(parsedTable.data.error.code).toBe('table.not_found');
    }
  });

  it('cannot read a View after the Table aggregate deletes that child', async () => {
    const commandBus = ctx.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const command = DeleteViewCommand.create({ tableId, viewId: disposableViewId });
    expect(command.isOk()).toBe(true);
    if (command.isErr()) return;
    const actorId = ActorId.create(TEST_USER.id)._unsafeUnwrap();
    const deleted = await commandBus.execute<DeleteViewCommand, DeleteViewResult>(
      { actorId },
      command.value
    );
    expect(deleted.isOk()).toBe(true);

    const { response, body } = await getViewRaw(tableId, disposableViewId);
    expect(response.status).toBe(404);
    const parsed = getViewErrorResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success && !parsed.data.ok) {
      expect(parsed.data.error.code).toBe('view.not_found');
    }
  });
});
