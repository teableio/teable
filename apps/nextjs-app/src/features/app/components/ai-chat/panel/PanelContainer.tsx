import { Resizable } from 're-resizable';
import { useChatPanelStore } from '../store/useChatPanelStore';
import { ChatContainer } from './ChatContainer';
import { ChatPanelHeader } from './ChatPanelHeader';

const DEFAULT_PANEL_WIDTH = '300px';

export const PanelContainer = ({ baseId }: { baseId: string }) => {
  const { width = DEFAULT_PANEL_WIDTH, updateWidth } = useChatPanelStore();

  return (
    <Resizable
      className="ml-1 flex h-full flex-col overflow-hidden bg-background px-1"
      size={{ width, height: '100%' }}
      defaultSize={{ width: DEFAULT_PANEL_WIDTH, height: '100%' }}
      maxWidth={'60%'}
      minWidth={'300px'}
      enable={{
        left: true,
      }}
      onResizeStop={(_e, _direction, ref) => {
        updateWidth(ref.style.width);
      }}
      handleClasses={{
        left: 'group',
      }}
      handleStyles={{
        left: {
          width: '4px',
          left: '0',
          zIndex: 50,
        },
      }}
      handleComponent={{
        left: (
          <div className="h-full w-px bg-border group-hover:px-[1.5px] group-active:px-[1.5px]"></div>
        ),
      }}
    >
      <ChatPanelHeader baseId={baseId} />
      <ChatContainer baseId={baseId} />
    </Resizable>
  );
};
