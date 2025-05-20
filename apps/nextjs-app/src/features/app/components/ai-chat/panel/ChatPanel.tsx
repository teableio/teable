import { useBaseId } from '@teable/sdk/hooks';
import { ChatProvider } from '../context/ChatProvider';
import { useChatEnabled } from '../hooks/useChatEnabled';
import { useChatPanelStore } from '../store/useChatPanelStore';
import { PanelContainer } from './PanelContainer';

export const ChatPanel = () => {
  const { isVisible } = useChatPanelStore();
  const baseId = useBaseId();
  const chatEnabled = useChatEnabled();

  if (!isVisible || !baseId || !chatEnabled) return <></>;

  return (
    <ChatProvider>
      <PanelContainer baseId={baseId} />
    </ChatProvider>
  );
};
