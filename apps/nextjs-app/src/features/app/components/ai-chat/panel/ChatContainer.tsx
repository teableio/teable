import { useChat, type UseChatHelpers } from '@ai-sdk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { generateChatId } from '@teable/core';
import { getAIConfig, getChatMessages } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useMemo, useRef } from 'react';
import { generateModelKeyList } from '@/features/app/blocks/admin/setting/components/ai-config/util';
import { MessageInput } from '../components/MessageInput';
import { Messages } from '../components/Messages';
import { useChatContext } from '../context/useChatContext';
import { useActiveChat } from '../hooks/useActiveChat';
import { useChatStore } from '../store/useChatStore';

export const ChatContainer = ({ baseId }: { baseId: string }) => {
  const chatIdRef = useRef(generateChatId());
  const { modelKey } = useChatStore();
  const activeChat = useActiveChat(baseId);
  const queryClient = useQueryClient();
  const { context, setActiveChatId } = useChatContext();

  const chatId = activeChat ? activeChat.id : chatIdRef.current;

  const { data: baseAiConfig } = useQuery({
    queryKey: ['ai-config', baseId],
    queryFn: () => getAIConfig(baseId).then(({ data }) => data),
  });

  const { data: chatMessage } = useQuery({
    queryKey: ['chat-message', chatId],
    queryFn: ({ queryKey }) => getChatMessages(baseId, queryKey[1]).then((res) => res.data),
    enabled: Boolean(activeChat),
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

  const { llmProviders = [], codingModel } = baseAiConfig ?? {};
  const models = useMemo(() => {
    return generateModelKeyList(llmProviders);
  }, [llmProviders]);

  const validModelKey = useMemo(() => {
    return (
      models.find((model) => model.modelKey === modelKey)?.modelKey ||
      codingModel ||
      models[0]?.modelKey
    );
  }, [modelKey, models, codingModel]);

  const { messages, setMessages, handleSubmit, input, setInput, status, stop } = useChat({
    api: `/api/base/${baseId}/chat`,
    initialMessages: convertToUIMessages,
    body: {
      chatId,
      model: validModelKey,
      context,
    },
    onResponse: () => {
      setActiveChatId(chatId);
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.chatHistory(baseId) });
    },
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden pb-3">
      <Messages messages={messages} chatId={chatId} status={status} />
      <MessageInput
        modelKey={validModelKey}
        models={models}
        input={input}
        setInput={setInput}
        status={status}
        stop={stop}
        setMessages={setMessages}
        handleSubmit={handleSubmit}
      />
    </div>
  );
};
