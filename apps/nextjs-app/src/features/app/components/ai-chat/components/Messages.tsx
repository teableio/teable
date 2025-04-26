import type { UseChatHelpers } from '@ai-sdk/react';
import { LoadingDot } from './LoadingDot';
import { Message, MessageWrapper } from './Message';
import { useScrollToBottom } from './use-scroll-to-bottom';

interface IMessages {
  chatId: string;
  messages: UseChatHelpers['messages'];
  status: UseChatHelpers['status'];
}

export const Messages = ({ messages, status }: IMessages) => {
  const isStreaming = status === 'streaming';
  const [messagesContainerRef, messagesEndRef] = useScrollToBottom<HTMLDivElement>(!isStreaming);
  const isLoadingAI =
    status === 'submitted' && messages.length > 0 && messages[messages.length - 1].role === 'user';
  const length = messages.length;

  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-scroll px-4 py-8"
      ref={messagesContainerRef}
    >
      {messages.map((message, i) => (
        <Message key={message.id} message={message} isLoading={i === length - 1 && isStreaming} />
      ))}
      {isLoadingAI && (
        <MessageWrapper
          message={{
            id: 'thinking',
            role: 'assistant',
            content: 'Thinking...',
            parts: [],
          }}
        >
          <LoadingDot />
        </MessageWrapper>
      )}
      <div ref={messagesEndRef} className="min-h-px min-w-[24px] shrink-0" />
    </div>
  );
};
