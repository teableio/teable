import { History, Plus, X } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useActiveChat } from '../hooks/useActiveChat';
import { useChatPanelStore } from '../store/useChatPanelStore';
import { useChatStore } from '../store/useChatStore';
import { ChatHistory } from './ChatHistory';

export const ChatPanelHeader = ({ baseId }: { baseId: string }) => {
  const activeChat = useActiveChat(baseId);
  const { close: closePanel } = useChatPanelStore();
  const { clearActiveChatId } = useChatStore();
  const { t } = useTranslation(['table']);
  const title = activeChat?.name ?? t('table:aiChat.newChat');

  return (
    <div className="flex h-[42px] items-center border-b pl-2 align-middle">
      <div className="line-clamp-1 flex-1 text-sm font-medium" title={title}>
        {title}
      </div>
      <div className="flex h-full items-center">
        <Button variant="ghost" size="xs" onClick={() => clearActiveChatId()}>
          <Plus className="size-4 font-normal" />
        </Button>
        <ChatHistory baseId={baseId}>
          <Button variant="ghost" size="xs">
            <History className="size-4 font-normal" />
          </Button>
        </ChatHistory>
        <Button variant="ghost" size="xs" onClick={closePanel}>
          <X className="size-4 font-normal" />
        </Button>
      </div>
    </div>
  );
};
