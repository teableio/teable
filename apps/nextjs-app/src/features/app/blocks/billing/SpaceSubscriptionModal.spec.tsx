import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BillingProductLevel } from '@teable/openapi';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpaceSubscriptionModal } from './SpaceSubscriptionModal';
import { useSpaceSubscriptionStore } from './useSpaceSubscriptionStore';

const { getSpaceList } = vi.hoisted(() => ({ getSpaceList: vi.fn() }));
vi.mock('@teable/openapi', async () => ({
  ...(await vi.importActual<object>('@teable/openapi')),
  getSpaceList,
}));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('SpaceSubscriptionModal', () => {
  beforeEach(() => {
    getSpaceList.mockReset().mockResolvedValue({ data: [] });
    useSpaceSubscriptionStore.setState({ subscribeLevel: undefined });
  });

  it('loads the space list only once the modal opens', async () => {
    // The sidebar footer keeps the modal mounted while it is closed.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <SpaceSubscriptionModal />
      </QueryClientProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getSpaceList).not.toHaveBeenCalled();

    act(() => useSpaceSubscriptionStore.getState().openModal(BillingProductLevel.Pro));
    await waitFor(() => expect(getSpaceList).toHaveBeenCalledTimes(1));
  });
});
