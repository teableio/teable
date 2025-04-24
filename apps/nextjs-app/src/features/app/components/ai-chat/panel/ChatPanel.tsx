import { useBaseId } from '@teable/sdk/hooks';
import { PanelContainer } from './PanelContainer';
import { useChatPanelStore } from './useChatPanelStore';

export const ChatPanel = () => {
  const { isVisible } = useChatPanelStore();
  const baseId = useBaseId();

  if (!isVisible || !baseId) return <></>;

  return <PanelContainer baseId={baseId} />;
};
