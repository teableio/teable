import { useBaseId } from '@teable/sdk/hooks';
import { ChatProvider } from '../context/ChatProvider';
import { useChatPanelStore } from '../store/useChatPanelStore';
import { PanelContainer } from './PanelContainer';

export const ChatPanel = () => {
  const { isVisible } = useChatPanelStore();
  const baseId = useBaseId();

  if (!isVisible || !baseId) return <></>;

  return (
    <ChatProvider>
      <PanelContainer baseId={baseId} />
    </ChatProvider>
  );
};
