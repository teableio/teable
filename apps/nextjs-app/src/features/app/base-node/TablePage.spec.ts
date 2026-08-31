import { QueryClient } from '@tanstack/react-query';
import { HttpError, HttpErrorCode, ViewType } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';

import type { SsrApi } from '@/backend/api/rest/ssr-api';
import type { IBaseResourceParsed } from '@/features/app/hooks/useBaseResource';
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
    context: {},
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
