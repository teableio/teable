import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import type * as SdkHooks from '@teable/sdk/hooks';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatPanelStore } from '@/features/app/components/sidebar/useChatPanelStore';
import { GridSelectionType } from '../grid/utils/gridSelectionChat';
import { useAddToChat } from './useAddToChat';

const ai = vi.hoisted(() => ({ enable: true, chatAIEnable: true }));
const ids = vi.hoisted(() => ({
  baseId: 'bseTest' as string | undefined,
  tableId: 'tblTest' as string | undefined,
}));

vi.mock('@teable/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkHooks>()),
  useBaseId: () => ids.baseId,
  useTableId: () => ids.tableId,
  useViewId: () => 'viwTest',
  useIsReadOnlyPreview: () => false,
}));
vi.mock('@/features/app/hooks/useAI', () => ({ useAI: () => ({ enable: ai.enable }) }));
vi.mock('@/features/app/hooks/useBaseUsage', () => ({
  useBaseUsage: () => ({ limit: { chatAIEnable: ai.chatAIEnable } }),
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useAddToChat', () => {
  beforeEach(() => {
    ai.enable = true;
    ai.chatAIEnable = true;
    ids.baseId = 'bseTest';
    ids.tableId = 'tblTest';
    queryClient.clear();
    queryClient.setQueryData(['ai-config', 'bseTest'], { disableActions: [] });
    useChatPanelStore.setState({ status: 'close' });
  });

  it.each(['close', 'expanded'] as const)(
    'offers the entry, references exactly the requested record and opens the panel from $status',
    (status) => {
      useChatPanelStore.setState({ status });
      const { result } = renderHook(() => useAddToChat(), { wrapper });

      expect(result.current.chatEnabled).toBe(true);
      act(() => result.current.addToChat('recTarget'));

      expect(queryClient.getQueryData(ReactQueryKeys.gridSelection('bseTest'))).toMatchObject({
        selectionType: GridSelectionType.Rows,
        tableId: 'tblTest',
        viewId: 'viwTest',
        recordIds: ['recTarget'],
        addToChat: true,
      });
      expect(useChatPanelStore.getState().status).toBe('open');
    }
  );

  it.each([
    { label: 'AI is disabled in the base', aiEnable: false, chatAIEnable: true },
    { label: 'the base has no chat quota', aiEnable: true, chatAIEnable: false },
  ])('hides the entry when $label', ({ aiEnable, chatAIEnable }) => {
    ai.enable = aiEnable;
    ai.chatAIEnable = chatAIEnable;

    const { result } = renderHook(() => useAddToChat(), { wrapper });

    expect(result.current.chatEnabled).toBe(false);
  });

  it.each([
    { label: 'a base', baseId: undefined, tableId: 'tblTest', recordId: 'recTarget' },
    { label: 'a table', baseId: 'bseTest', tableId: undefined, recordId: 'recTarget' },
    { label: 'a record id', baseId: 'bseTest', tableId: 'tblTest', recordId: undefined },
  ])('does nothing without $label', ({ baseId, tableId, recordId }) => {
    ids.baseId = baseId;
    ids.tableId = tableId;
    const { result } = renderHook(() => useAddToChat(), { wrapper });

    act(() => result.current.addToChat(recordId));

    expect(queryClient.getQueryData(ReactQueryKeys.gridSelection('bseTest'))).toBeUndefined();
    expect(useChatPanelStore.getState().status).toBe('close');
  });
});
