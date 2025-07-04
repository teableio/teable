import type { UseChatHelpers } from '@ai-sdk/react';
import { isEqual } from 'lodash';
import { useState, useCallback, useEffect, memo } from 'react';
import { LoadingDot } from './common/LoadingDot';
import { Message, MessageWrapper } from './Message';
import type { IMessageMeta } from './types';
import { useScrollToBottom } from './use-scroll-to-bottom';

interface IMessages {
  chatId: string;
  messages: UseChatHelpers['messages'];
  status: UseChatHelpers['status'];
  messageMetaMap?: Record<string, IMessageMeta>;
}

export const PureMessages = ({ messages, status, messageMetaMap, chatId }: IMessages) => {
  const isStreaming = status === 'streaming';
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [messagesContainerRef, messagesEndRef] = useScrollToBottom<HTMLDivElement>(
    !isStreaming || !isAutoScroll
  );
  const isLoadingAI =
    status === 'submitted' && messages.length > 0 && messages[messages.length - 1].role === 'user';
  const length = messages.length;

  useEffect(() => {
    if (status === 'submitted') {
      setIsAutoScroll(true);
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
    }
  }, [messagesEndRef, status]);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceToBottom > 50) {
      setIsAutoScroll(false);
    } else {
      setIsAutoScroll(true);
    }
  }, [messagesContainerRef]);

  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-scroll px-4 py-8"
      ref={messagesContainerRef}
      onScroll={handleScroll}
    >
      {messages.map((message, i) => (
        <Message
          key={message.id}
          chatId={chatId}
          message={message}
          meta={messageMetaMap?.[message.id]}
          isLoading={i === length - 1 && isStreaming}
        />
      ))}
      {isLoadingAI && (
        <MessageWrapper
          chatId={chatId}
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

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.status && nextProps.status) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;
  if (!isEqual(prevProps.messages, nextProps.messages)) return false;
  if (!isEqual(prevProps.messageMetaMap, nextProps.messageMetaMap)) return false;

  return true;
});
