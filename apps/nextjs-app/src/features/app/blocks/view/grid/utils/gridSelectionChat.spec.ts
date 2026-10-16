import { QueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import { describe, expect, it, vi } from 'vitest';
import { cacheRecordIndexForChat } from './gridSelectionChat';

const requestMobileOpen = vi.fn();

vi.mock('@/features/app/components/sidebar/useChatPanelStore', () => ({
  useChatPanelStore: {
    getState: () => ({
      open: vi.fn(),
      requestMobileOpen,
    }),
  },
}));

describe('cacheRecordIndexForChat', () => {
  it('identifies the displayed record, not only its row index', () => {
    const queryClient = new QueryClient();

    cacheRecordIndexForChat(queryClient, 'bse1', 4, {
      tableId: 'tblGallery',
      viewId: 'viwGallery',
      recordId: 'recDisplayed',
    });

    expect(queryClient.getQueryData(ReactQueryKeys.gridSelection('bse1'))).toMatchObject({
      rows: [[4, 4]],
      tableId: 'tblGallery',
      viewId: 'viwGallery',
      recordId: 'recDisplayed',
      addToChat: true,
    });
    expect(requestMobileOpen).toHaveBeenCalled();
  });
});
