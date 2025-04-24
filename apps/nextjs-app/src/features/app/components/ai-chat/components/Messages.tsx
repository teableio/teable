import type { UseChatHelpers } from '@ai-sdk/react';
import { Spin } from '@teable/ui-lib/base';
import { Message, MessageWrapper } from './Message';
import { useScrollToBottom } from './use-scroll-to-bottom';

interface IMessages {
  chatId: string;
  messages: UseChatHelpers['messages'];
  status: UseChatHelpers['status'];
}

export const Messages = ({ messages, status }: IMessages) => {
  const [messagesContainerRef, messagesEndRef] = useScrollToBottom<HTMLDivElement>();
  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-scroll px-4 py-8"
      ref={messagesContainerRef}
    >
      {messages.map((message) => (
        <Message key={message.id} message={message} />
      ))}
      {status === 'submitted' &&
        messages.length > 0 &&
        messages[messages.length - 1].role === 'user' && (
          <MessageWrapper
            message={{
              id: 'thinking',
              role: 'assistant',
              content: 'Thinking...',
              parts: [],
            }}
          >
            <div className="flex h-7 items-center justify-center">
              <Spin />
            </div>
          </MessageWrapper>
        )}
      <div ref={messagesEndRef} className="min-h-px min-w-[24px] shrink-0" />
    </div>
  );
};
