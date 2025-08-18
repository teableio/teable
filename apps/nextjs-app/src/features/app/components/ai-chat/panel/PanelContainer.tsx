import { useIsMobile } from '@teable/sdk/hooks';
import { Resizable } from 're-resizable';
import { useRef, forwardRef, useImperativeHandle } from 'react';
import { useChatPanelStore } from '../store/useChatPanelStore';
import type { ChatContainerRef } from './ChatContainer';
import { ChatContainer } from './ChatContainer';
import { ChatPanelHeader } from './ChatPanelHeader';

const DEFAULT_PANEL_WIDTH = '300px';

export interface PanelContainerRef {
  setInputValue: (value: string) => void;
  submit: () => void;
}

export const PanelContainer = forwardRef<PanelContainerRef, { baseId: string; maxWidth?: string }>(
  ({ baseId, maxWidth = '60%' }, ref) => {
    const { width = DEFAULT_PANEL_WIDTH, updateWidth } = useChatPanelStore();
    const isMobile = useIsMobile();
    const chatContainerRef = useRef<ChatContainerRef>(null);

    useImperativeHandle(ref, () => ({
      setInputValue: (value: string) => {
        chatContainerRef.current?.setInputValue(value);
      },
      submit: () => {
        chatContainerRef.current?.submit();
      },
    }));

    if (isMobile) {
      return (
        <div className="fixed z-50 flex size-full flex-col overflow-hidden bg-background px-1">
          <ChatPanelHeader baseId={baseId} />
          <ChatContainer baseId={baseId} ref={chatContainerRef} />
        </div>
      );
    }

    return (
      <Resizable
        className="ml-1 flex h-full flex-col overflow-hidden bg-background px-1"
        size={{ width, height: '100%' }}
        defaultSize={{ width: DEFAULT_PANEL_WIDTH, height: '100%' }}
        maxWidth={maxWidth}
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
        <ChatContainer baseId={baseId} ref={chatContainerRef} />
      </Resizable>
    );
  }
);

PanelContainer.displayName = 'PanelContainer';
