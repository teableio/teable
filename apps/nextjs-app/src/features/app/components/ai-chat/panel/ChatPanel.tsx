import { useBaseId } from '@teable/sdk/hooks';
import { useChatPanelStore } from '../store/useChatPanelStore';
import { PanelContainer } from './PanelContainer';

export const ChatPanel = () => {
  const { isVisible } = useChatPanelStore();
  const baseId = useBaseId();

  if (!isVisible || !baseId) return <></>;
  return <PanelContainer baseId={baseId} />;
};
