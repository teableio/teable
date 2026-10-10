import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as OpenApi from '@teable/openapi';
import { getUserIntegrationList, UserIntegrationProvider } from '@teable/openapi';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectedAccounts } from './useConnectedAccounts';
import type { useConnectIntegration } from './useConnectIntegration';

type IConnectOptions = NonNullable<Parameters<typeof useConnectIntegration>[0]>;
const connect = vi.fn(() => true);
let connectOptions: IConnectOptions | undefined;
vi.mock('./useConnectIntegration', () => ({
  useConnectIntegration: (options: IConnectOptions) => {
    connectOptions = options;
    return { connect, isConnecting: false, cancelConnect: vi.fn() };
  },
}));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  getUserIntegrationList: vi.fn(),
}));

const row = (id: string, hasSecret = true) =>
  ({ id, name: id, provider: UserIntegrationProvider.GoogleSheet, hasSecret }) as never;
const list = (...rows: unknown[]) => Promise.resolve({ data: { integrations: rows } } as never);

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('useConnectedAccounts', () => {
  beforeEach(() => {
    vi.mocked(getUserIntegrationList).mockReset();
    connect.mockClear();
    connectOptions = undefined;
  });

  it('lists only accounts with a credential, and switches with a notice only on a real change', async () => {
    vi.mocked(getUserIntegrationList).mockReturnValue(list(row('a'), row('dead', false), row('b')));
    const onSwitch = vi.fn();
    const { result } = renderHook(
      () =>
        useConnectedAccounts({
          provider: UserIntegrationProvider.GoogleSheet,
          queryKey: 'spec',
          onSwitch,
        }),
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.accounts?.map((item) => item.id)).toEqual(['a', 'b'])
    );

    act(() => result.current.switchAccount(result.current.accounts![0]));
    act(() => result.current.switchAccount(result.current.accounts![0]));
    expect(result.current.chosen?.id).toBe('a');
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it('re-authorizes the same row and adopts the account that went through consent', async () => {
    vi.mocked(getUserIntegrationList).mockReturnValue(list(row('a'), row('b')));
    const onConnected = vi.fn();
    const { result } = renderHook(
      () =>
        useConnectedAccounts({
          provider: UserIntegrationProvider.GoogleSheet,
          name: 'Google Sheets',
          queryKey: 'spec',
          onConnected,
        }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.accounts).toHaveLength(2));

    act(() => result.current.setStaleId('b'));
    result.current.reauthorize(result.current.accounts![1]);
    expect(connect).toHaveBeenCalledWith(UserIntegrationProvider.GoogleSheet, {
      name: 'Google Sheets',
      integrationId: 'b',
    });

    // Consent came back for b (not a, which the list puts first): b is in use, nothing stale.
    await act(async () => {
      connectOptions?.onConnected?.(UserIntegrationProvider.GoogleSheet, 'b');
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.chosen?.id).toBe('b'));
    expect(result.current.staleId).toBeNull();
    expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    expect(result.current.reauthorize(null)).toBe(false);
  });
});
