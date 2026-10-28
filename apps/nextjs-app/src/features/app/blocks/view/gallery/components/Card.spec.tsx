import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IRecord } from '@teable/core';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import { ReactQueryKeys } from '@teable/sdk/config';
import type * as SdkHooks from '@teable/sdk/hooks';
import {
  createFieldInstance,
  createRecordInstance,
  recordInstanceFieldMap,
} from '@teable/sdk/model';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatPanelStore } from '@/features/app/components/sidebar/useChatPanelStore';
import { GalleryContext } from '../context/GalleryContext';
import { Card } from './Card';

const ai = vi.hoisted(() => ({ enable: true, chatAIEnable: true }));

vi.mock('@teable/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkHooks>()),
  useBaseId: () => 'bseTest',
  useTableId: () => 'tblTest',
  useViewId: () => 'viwTest',
  useIsReadOnlyPreview: () => false,
  useFieldStaticGetter: () => () => ({ Icon: () => null }),
}));
vi.mock('../../hooks/useContextMenu', () => ({
  useContextMenu: () => ({
    copyRecordUrl: vi.fn(),
    viewRecordHistory: vi.fn(),
    addRecordComment: vi.fn(),
  }),
}));
vi.mock('@/features/app/hooks/useAI', () => ({ useAI: () => ({ enable: ai.enable }) }));
vi.mock('@/features/app/hooks/useBaseUsage', () => ({
  useBaseUsage: () => ({ limit: { chatAIEnable: ai.chatAIEnable } }),
}));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@teable/sdk/context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const primary = createFieldInstance({
  id: 'fldName',
  name: 'Name',
  dbFieldName: 'name',
  type: FieldType.SingleLineText,
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Text,
  options: {},
  isPrimary: true,
});

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });

const renderCard = (recordId = 'recCard') => {
  const card = recordInstanceFieldMap(
    createRecordInstance({ id: recordId, fields: { [primary.id]: 'r1' } } as IRecord),
    { [primary.id]: primary }
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <GalleryContext.Provider
        value={{
          permission: {
            cardCreatable: false,
            cardEditable: false,
            cardDeletable: false,
            cardDraggable: false,
            cardCommentReadable: false,
            cardCommentCreatable: false,
          },
          primaryField: primary,
          displayFields: [],
          setExpandRecordId: vi.fn(),
        }}
      >
        <Card card={card} />
      </GalleryContext.Provider>
    </QueryClientProvider>
  );
};

describe('gallery card add to chat', () => {
  beforeEach(() => {
    ai.enable = true;
    ai.chatAIEnable = true;
    queryClient.clear();
    queryClient.setQueryData(['disable-ai-actions', 'bseTest'], { disableActions: [] });
    useChatPanelStore.setState({ status: 'close' });
  });

  it('references the clicked card and opens the chat panel from the menu', async () => {
    renderCard('recCard');

    fireEvent.contextMenu(screen.getByText('r1'));
    fireEvent.click(await screen.findByText('table:menu.addToChat'));

    expect(queryClient.getQueryData(ReactQueryKeys.gridSelection('bseTest'))).toMatchObject({
      tableId: 'tblTest',
      viewId: 'viwTest',
      recordIds: ['recCard'],
      addToChat: true,
    });
    expect(useChatPanelStore.getState().status).toBe('open');
  });

  it('hides the entry when AI chat is unavailable', () => {
    ai.enable = false;

    renderCard();

    fireEvent.contextMenu(screen.getByText('r1'));
    expect(screen.queryByText('table:menu.addToChat')).toBeNull();
  });

  it('hides the entry when a space admin disables AI chat with configuration and quota available', () => {
    queryClient.setQueryData(['disable-ai-actions', 'bseTest'], {
      disableActions: ['ai-chat'],
    });

    renderCard();

    fireEvent.contextMenu(screen.getByText('r1'));
    expect(screen.queryByText('table:menu.addToChat')).toBeNull();
  });
});
