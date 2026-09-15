import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useShareAwareQuery } from './use-share-aware-query';

describe('useShareAwareQuery cancellation', () => {
  it.each([undefined, 'share-id'])('aborts obsolete searches for shareId=%s', async (shareId) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const signals: AbortSignal[] = [];
    const queryFn = vi.fn(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise<number>(() => {});
    });
    const inactiveQueryFn = vi.fn(async () => 0);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { rerender, unmount } = renderHook(
      ({ search }) =>
        useShareAwareQuery({
          shareId,
          enabled: true,
          common: {
            queryKey: ['common-count', search],
            queryFn: shareId ? inactiveQueryFn : queryFn,
          },
          share: {
            queryKey: ['share-count', search],
            queryFn: shareId ? queryFn : inactiveQueryFn,
          },
        }),
      { wrapper, initialProps: { search: 'first' } }
    );
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0].aborted).toBe(false);
    act(() => rerender({ search: 'second' }));
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(inactiveQueryFn).not.toHaveBeenCalled();
    unmount();
    expect(signals[1].aborted).toBe(true);
    client.clear();
  });
});
