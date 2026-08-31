import {
  ActorId,
  domainError,
  GetViewQuery,
  GetViewResult,
  type IExecutionContext,
  type IQueryBus,
  ListViewsQuery,
  ListViewsResult,
  err,
  ok,
  type ViewQueryResultView,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import { executeGetViewEndpoint } from './getView';
import { executeListViewsEndpoint } from './listViews';

const tableId = `tbl${'a'.repeat(16)}`;
const viewId = `viw${'a'.repeat(16)}`;
const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};
const view: ViewQueryResultView = {
  id: viewId,
  version: 2,
  name: 'Planning',
  type: 'grid',
  options: { rowHeight: 'short' },
  createdBy: 'system',
  createdTime: '2026-07-31T00:00:00.000Z',
  columnMeta: {},
};

const createQueryBus = (execute: IQueryBus['execute']): IQueryBus => ({ execute });

describe('executeGetViewEndpoint', () => {
  it('validates nominal IDs before dispatching', async () => {
    const execute = vi.fn();

    const result = await executeGetViewEndpoint(
      context,
      { tableId: 'invalid', viewId: 'invalid' },
      createQueryBus(execute)
    );

    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('dispatches GetViewQuery and preserves the aggregate-backed projection', async () => {
    const execute = vi.fn(async (_context, query) => {
      expect(query).toBeInstanceOf(GetViewQuery);
      expect(query.tableId.toString()).toBe(tableId);
      expect(query.viewId.toString()).toBe(viewId);
      return ok(GetViewResult.create(view));
    });

    const result = await executeGetViewEndpoint(
      context,
      { tableId, viewId },
      createQueryBus(execute)
    );

    expect(result).toEqual({
      status: 200,
      body: { ok: true, data: { view } },
    });
  });

  it('maps a missing View child to the HTTP error contract', async () => {
    const execute = vi.fn(async () =>
      err(domainError.notFound({ code: 'view.not_found', message: 'View not found' }))
    );

    const result = await executeGetViewEndpoint(
      context,
      { tableId, viewId },
      createQueryBus(execute)
    );

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({
      ok: false,
      error: { code: 'view.not_found' },
    });
  });
});

describe('executeListViewsEndpoint', () => {
  it('dispatches ListViewsQuery with the requested projection', async () => {
    const execute = vi.fn(async (_context, query) => {
      expect(query).toBeInstanceOf(ListViewsQuery);
      expect(query.tableId.toString()).toBe(tableId);
      expect(query.viewIds?.map((id) => id.toString())).toEqual([viewId]);
      return ok(ListViewsResult.create([view]));
    });

    const result = await executeListViewsEndpoint(
      context,
      { tableId, viewIds: [viewId, viewId] },
      createQueryBus(execute)
    );

    expect(result).toEqual({
      status: 200,
      body: { ok: true, data: { views: [view] } },
    });
  });

  it('rejects an invalid projected View ID before dispatching', async () => {
    const execute = vi.fn();

    const result = await executeListViewsEndpoint(
      context,
      { tableId, viewIds: ['invalid'] },
      createQueryBus(execute)
    );

    expect(result.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('maps unexpected repository failures to the HTTP error contract', async () => {
    const execute = vi.fn(async () => err(domainError.unexpected({ message: 'query failed' })));

    const result = await executeListViewsEndpoint(context, { tableId }, createQueryBus(execute));

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      ok: false,
      error: { message: 'query failed' },
    });
  });
});
