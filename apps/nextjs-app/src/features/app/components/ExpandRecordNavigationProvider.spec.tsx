import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as OpenApi from '@teable/openapi';
import { useExpandRecordNavigation } from '@teable/sdk';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ExpandRecordNavigationProvider } from './ExpandRecordNavigationProvider';

const { push, getUserLastVisitMap } = vi.hoisted(() => ({
  push: vi.fn(),
  getUserLastVisitMap: vi.fn(),
}));

vi.mock('next/router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  getUserLastVisitMap,
}));
vi.mock('@teable/sdk/hooks', () => ({
  useBaseId: () => 'bseOne',
  useTables: () => [{ id: 'tblOne', defaultViewId: 'viwDefault' }],
}));
vi.mock('@teable/sdk/hooks/use-is-readonly-preview', () => ({ useIsReadOnlyPreview: () => false }));
vi.mock('../context/ShareContext', () => ({ useShareUrlPrefix: () => '/share/shrOne' }));

describe('ExpandRecordNavigationProvider', () => {
  it('jumps to a linked table inside the base share it was opened from', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ExpandRecordNavigationProvider>{children}</ExpandRecordNavigationProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useExpandRecordNavigation(), { wrapper });

    result.current.navigateToTable?.('tblOne');

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        { pathname: '/share/shrOne/base/bseOne/table/tblOne/viwDefault' },
        undefined,
        { shallow: true }
      )
    );
    // a share visitor has no last-visit history to look up
    expect(getUserLastVisitMap).not.toHaveBeenCalled();
    expect(result.current.onHighlightTable).toBeTypeOf('function');
  });
});
