import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as OpenApi from '@teable/openapi';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useTableHref } from './useTableHref';

const { getUserLastVisitMap } = vi.hoisted(() => ({ getUserLastVisitMap: vi.fn() }));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  getUserLastVisitMap,
}));
vi.mock('@teable/sdk/hooks', () => ({
  useBaseId: () => 'bseOne',
  useTables: () => [{ id: 'tblOne', defaultViewId: 'viwDefault' }],
}));
vi.mock('@teable/sdk/hooks/use-is-readonly-preview', () => ({ useIsReadOnlyPreview: () => false }));
vi.mock('../../context/ShareContext', () => ({ useShareUrlPrefix: () => '' }));

describe('useTableHref', () => {
  it('defers the last-visited views to the jump that needs them', async () => {
    getUserLastVisitMap.mockResolvedValue({ data: { tblOne: { resourceId: 'viwLast' } } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useTableHref(false), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getUserLastVisitMap).not.toHaveBeenCalled();
    expect(result.current.viewIdMap).toEqual({ tblOne: 'viwDefault' });

    await expect(result.current.loadTableHref()).resolves.toEqual({
      hrefMap: { tblOne: '/base/bseOne/table/tblOne/viwLast' },
      viewIdMap: { tblOne: 'viwLast' },
    });
    expect(getUserLastVisitMap).toHaveBeenCalledTimes(1);
  });
});
