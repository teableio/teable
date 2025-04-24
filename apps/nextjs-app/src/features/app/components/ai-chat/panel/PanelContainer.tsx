import { useChat, type UseChatHelpers } from '@ai-sdk/react';
import { useQuery } from '@tanstack/react-query';
import { getChatMessages } from '@teable/openapi';
import { Resizable } from 're-resizable';
import { useMemo } from 'react';
import { MessageInput } from '../components/MessageInput';
import { Messages } from '../components/Messages';
import { useChatPanelStore } from './useChatPanelStore';

const DEFAULT_PANEL_WIDTH = '300px';

const chatId = 'cht1234567891234567';

export const PanelContainer = ({ baseId }: { baseId: string }) => {
  const { width = DEFAULT_PANEL_WIDTH, updateWidth } = useChatPanelStore();
  const { data: chatMessage } = useQuery({
    queryKey: ['chat-message', chatId],
    queryFn: ({ queryKey }) => getChatMessages(baseId, queryKey[1]).then((res) => res.data),
  });

  const convertToUIMessages = useMemo<UseChatHelpers['messages']>(() => {
    return (
      chatMessage?.messages.map((message) => ({
        id: message.id,
        role: message.role as UseChatHelpers['messages'][number]['role'],
        parts: message.parts as UseChatHelpers['messages'][number]['parts'],
        content: '',
        createdAt: new Date(message.createdTime),
      })) ?? []
    );
  }, [chatMessage]);

  const { messages, setMessages, handleSubmit, input, setInput, status, stop } = useChat({
    api: `/api/base/${baseId}/chat`,
    initialMessages: convertToUIMessages,
    body: {
      chatId,
    },
  });

  return (
    <Resizable
      className="ml-1 bg-background px-1"
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
      <div className="flex size-full flex-col overflow-hidden">
        <Messages messages={messages} chatId={chatId} status={status} />
        <MessageInput
          input={input}
          setInput={setInput}
          status={status}
          stop={stop}
          setMessages={setMessages}
          handleSubmit={handleSubmit}
        />
      </div>
    </Resizable>
  );
};
