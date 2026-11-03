import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as OpenApi from '@teable/openapi';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDisableAIAction } from './useDisableAIAction';

const { getAIConfig } = vi.hoisted(() => ({ getAIConfig: vi.fn() }));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  getAIConfig,
}));
vi.mock('@teable/sdk/hooks', () => ({
  useBaseId: () => 'bseOne',
  useIsReadOnlyPreview: () => false,
}));

const render = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useDisableAIAction(), { wrapper });
};

describe('useDisableAIAction', () => {
  beforeEach(() => {
    getAIConfig.mockReset();
  });

  it('reads the disabled actions from the AI config', async () => {
    getAIConfig.mockResolvedValue({ data: { llmProviders: [], disableActions: ['ai-field'] } });
    const { result } = render();
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current).toMatchObject({ aiField: false, aiChat: true });
    expect(getAIConfig).toHaveBeenCalledTimes(1);
  });

  it.each([null, ''])(
    'offers no AI action while the base has no AI configured (%j)',
    async (config) => {
      getAIConfig.mockResolvedValue({ data: config });
      const { result } = render();
      await waitFor(() => expect(result.current.isReady).toBe(true));
      expect(result.current).toMatchObject({ aiField: false, aiChat: false, isSettled: true });
    }
  );

  it('offers every action until the config arrives', () => {
    getAIConfig.mockReturnValue(new Promise(() => {}));
    const { result } = render();
    expect(result.current).toMatchObject({ aiField: true, aiChat: true, isReady: false });
  });
});
