import { QueryClient } from '@tanstack/react-query';
import { HttpError, HttpErrorCode, ViewType } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import type { SsrApi } from '@/backend/api/rest/ssr-api';
import type { IBaseResourceParsed } from '@/features/app/hooks/useBaseResource';

import { getBaseServerSideProps } from './BasePage';
import { getTableServerSideProps } from './TablePage';
import type { ISSRContext } from './types';

const parsed: IBaseResourceParsed = {
  resourceType: BaseNodeResourceType.Table,
  tableId: 'tblA',
  viewId: 'viwA',
} as IBaseResourceParsed;

const createSsrApi = (overrides: Partial<Record<keyof SsrApi, unknown>> = {}) => {
  return {
    getTables: vi.fn().mockResolvedValue([{ id: 'tblA' }]),
    getViewList: vi.fn().mockResolvedValue([{ id: 'viwA', type: ViewType.Grid }]),
    getTable: vi.fn().mockResolvedValue({
      fields: [],
      views: [{ id: 'viwA', type: ViewType.Grid }],
      records: [],
      extra: undefined,
    }),
    getTablePermission: vi.fn().mockResolvedValue({}),
    getRecord: vi.fn(),
    updateNotificationStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SsrApi;
};

const createCtx = (ssrApi: SsrApi): ISSRContext =>
  ({
    context: { query: {} },
    queryClient: new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    }),
    baseId: 'bseA',
    ssrApi,
    getTranslationsProps: async () => ({}) as never,
    base: { id: 'bseA' },
  }) as unknown as ISSRContext;

describe('getTableServerSideProps recordId handling', () => {
  it('redirects to the plain table view when the recordId query param is not a record id', async () => {
    const ssrApi = createSsrApi();
    const result = await getTableServerSideProps(createCtx(ssrApi), parsed, {
      recordId: 'r47001an',
    });

    expect(result).toEqual({
      redirect: { destination: '/base/bseA/table/tblA/viwA', permanent: false },
    });
    // Garbage ids never reach the record API
    expect(ssrApi.getRecord).not.toHaveBeenCalled();
  });

  it('redirects to the plain table view when the record fetch is rejected with a client error', async () => {
    const ssrApi = createSsrApi({
      getRecord: vi
        .fn()
        .mockRejectedValue(
          new HttpError({ message: 'Invalid RecordId', code: HttpErrorCode.VALIDATION_ERROR }, 400)
        ),
    });
    const result = await getTableServerSideProps(createCtx(ssrApi), parsed, {
      recordId: 'recMalformedId',
    });

    expect(result).toEqual({
      redirect: { destination: '/base/bseA/table/tblA/viwA', permanent: false },
    });
    expect(ssrApi.getRecord).toHaveBeenCalledWith('tblA', 'recMalformedId');
  });

  it('redirects to the plain table view when the record is gone (404)', async () => {
    const ssrApi = createSsrApi({
      getRecord: vi.fn().mockRejectedValue(new HttpError({ message: 'Record not found' }, 404)),
    });
    const result = await getTableServerSideProps(createCtx(ssrApi), parsed, {
      recordId: 'recDeletedRecord',
    });

    expect(result).toEqual({
      redirect: { destination: '/base/bseA/table/tblA/viwA', permanent: false },
    });
  });

  it('rethrows server errors from the record fetch', async () => {
    const boom = new HttpError({ message: 'Internal server error' }, 500);
    const ssrApi = createSsrApi({ getRecord: vi.fn().mockRejectedValue(boom) });

    await expect(
      getTableServerSideProps(createCtx(ssrApi), parsed, { recordId: 'recSomeRecord' })
    ).rejects.toBe(boom);
  });
});

// The visible table list cannot tell a deleted table from one the role hides: either way the
// page falls back, and the marker lets it say that the linked table did not open.
describe('getTableServerSideProps unreadable table anchor', () => {
  it('falls back to a visible table and marks the dropped one', async () => {
    const ssrApi = createSsrApi({
      getTables: vi.fn().mockResolvedValue([{ id: 'tblB' }]),
      getUserLastVisitBaseNode: vi.fn().mockResolvedValue(undefined),
      getBaseNodeList: vi
        .fn()
        .mockResolvedValue([{ resourceType: BaseNodeResourceType.Table, resourceId: 'tblB' }]),
      getUserLastVisit: vi.fn().mockResolvedValue(undefined),
      getViewList: vi.fn().mockResolvedValue([{ id: 'viwB', type: ViewType.Grid }]),
    });
    const result = await getTableServerSideProps(createCtx(ssrApi), parsed);

    expect(result).toEqual({
      redirect: { destination: '/base/bseA/table/tblB/viwB?staleTableId=tblA', permanent: false },
    });
  });

  it('returns to the project page, marked, when the reader can see no table or node', async () => {
    const ssrApi = createSsrApi({
      getTables: vi.fn().mockResolvedValue([]),
      getUserLastVisitBaseNode: vi.fn().mockResolvedValue(undefined),
      getBaseNodeList: vi.fn().mockResolvedValue([]),
    });
    const result = await getTableServerSideProps(createCtx(ssrApi), parsed);

    expect(result).toEqual({
      redirect: { destination: '/base/bseA?staleTableId=tblA', permanent: false },
    });
  });
});

const tableHome = { resourceType: BaseNodeResourceType.Table } as IBaseResourceParsed;
const invalidSchema = () =>
  new HttpError(
    {
      message: 'Invalid FieldId',
      code: HttpErrorCode.VALIDATION_ERROR,
      data: { domainCode: 'validation.invalid' },
    },
    400
  );

const createHomeApi = (lastTableId?: string) =>
  createSsrApi({
    getTables: vi.fn().mockResolvedValue([{ id: 'tblBroken' }, { id: 'tblA' }, { id: 'tblB' }]),
    getBaseNodeList: vi.fn().mockResolvedValue(
      ['tblBroken', 'tblA', 'tblB'].map((resourceId) => ({
        resourceId,
        resourceType: BaseNodeResourceType.Table,
      }))
    ),
    getUserLastVisitBaseNode: vi
      .fn()
      .mockResolvedValue(lastTableId ? { resourceId: lastTableId } : undefined),
    getUserLastVisit: vi
      .fn()
      .mockImplementation(async (_type, parentId) =>
        parentId === 'bseA' && lastTableId ? { resourceId: lastTableId } : undefined
      ),
    getViewList: vi.fn().mockImplementation(async (tableId) => {
      if (tableId === 'tblBroken') throw invalidSchema();
      return [{ id: tableId === 'tblA' ? 'viwA' : 'viwB', type: ViewType.Grid }];
    }),
  });

describe.each([
  ['base home', (ctx: ISSRContext) => getBaseServerSideProps(ctx)],
  ['table home', (ctx: ISSRContext) => getTableServerSideProps(ctx, tableHome)],
] as const)('%s default selection', (_name, openHome) => {
  it.each([undefined, 'tblBroken'])(
    'opens a healthy table when the first or last visited table is unreadable (%s)',
    async (lastTableId) => {
      const result = await openHome(createCtx(createHomeApi(lastTableId)));

      expect(result).toEqual({
        redirect: { destination: '/base/bseA/table/tblA/viwA', permanent: false },
      });
    }
  );

  it('preserves a readable last visited table and view', async () => {
    const api = createHomeApi('tblB');
    vi.mocked(api.getUserLastVisit).mockImplementation(
      async (_type, parentId) => ({ resourceId: parentId === 'bseA' ? 'tblB' : 'viwLast' }) as never
    );
    vi.mocked(api.getViewList).mockResolvedValue([
      { id: 'viwB', type: ViewType.Grid },
      { id: 'viwLast', type: ViewType.Grid },
    ] as never);

    expect(await openHome(createCtx(api))).toEqual({
      redirect: { destination: '/base/bseA/table/tblB/viwLast', permanent: false },
    });
  });

  it.each([403, 404])('skips a table that became unavailable with HTTP %s', async (status) => {
    const api = createHomeApi();
    vi.mocked(api.getViewList).mockImplementation(async (tableId) => {
      if (tableId === 'tblBroken') throw new HttpError({ message: 'Unavailable' }, status);
      return [{ id: 'viwA', type: ViewType.Grid }] as never;
    });

    expect(await openHome(createCtx(api))).toEqual({
      redirect: { destination: '/base/bseA/table/tblA/viwA', permanent: false },
    });
  });

  it('skips a retained table with no active views', async () => {
    const api = createHomeApi();
    vi.mocked(api.getViewList).mockImplementation(
      async (tableId) =>
        (tableId === 'tblBroken' ? [] : [{ id: 'viwA', type: ViewType.Grid }]) as never
    );

    expect(await openHome(createCtx(api))).toEqual({
      redirect: { destination: '/base/bseA/table/tblA/viwA', permanent: false },
    });
  });

  it('does not hide an unrelated bad request', async () => {
    const api = createHomeApi();
    const failure = new HttpError({ message: 'Bad request' }, 400);
    vi.mocked(api.getViewList).mockRejectedValue(failure);

    await expect(openHome(createCtx(api))).rejects.toBe(failure);
  });

  it.each([401, 429, 500])('does not hide HTTP %s as another table', async (status) => {
    const api = createHomeApi();
    const failure = new HttpError({ message: 'Request failed' }, status);
    vi.mocked(api.getViewList).mockRejectedValue(failure);

    await expect(openHome(createCtx(api))).rejects.toBe(failure);
  });
});

it('renders the base home when every table is unreadable, without a redirect loop', async () => {
  const api = createHomeApi('tblBroken');
  vi.mocked(api.getViewList).mockRejectedValue(invalidSchema());

  expect(await getTableServerSideProps(createCtx(api), tableHome)).toEqual({
    redirect: { destination: '/base/bseA', permanent: false },
  });
  const result = await getBaseServerSideProps(createCtx(api));
  expect(result).toMatchObject({ props: { base: { id: 'bseA' } } });
  expect(result).not.toHaveProperty('redirect');
});

it('falls through unreadable table nodes to a non-table resource', async () => {
  const api = createHomeApi('tblBroken');
  vi.mocked(api.getBaseNodeList).mockResolvedValue([
    { resourceType: BaseNodeResourceType.Table, resourceId: 'tblBroken' },
    { resourceType: BaseNodeResourceType.Dashboard, resourceId: 'dshA' },
  ] as never);

  expect(await getBaseServerSideProps(createCtx(api))).toEqual({
    redirect: { destination: '/base/bseA/dashboard/dshA', permanent: false },
  });
});
