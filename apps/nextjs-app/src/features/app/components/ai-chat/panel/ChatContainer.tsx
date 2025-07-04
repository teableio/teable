import { useChat, type UseChatHelpers } from '@ai-sdk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { generateChatId } from '@teable/core';
import { getAIConfig, getChatMessages } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useEffect, useMemo, useRef } from 'react';
import { generateModelKeyList } from '@/features/app/blocks/admin/setting/components/ai-config/utils';
import { MessageInput } from '../components/MessageInput';
import { Messages } from '../components/Messages';
import type { IMessageMeta } from '../components/types';
import { ChatThreadProvider } from '../context/chat-thread/ChatThreadProvider';
import { useChatContext } from '../context/useChatContext';
import { useActiveChat } from '../hooks/useActiveChat';
import { useChatStore } from '../store/useChatStore';

export const ChatContainer = ({ baseId }: { baseId: string }) => {
  const chatIdRef = useRef(generateChatId());
  const { modelKey, setModelKey } = useChatStore();
  const activeChat = useActiveChat(baseId);
  const queryClient = useQueryClient();
  const { context, setActiveChatId } = useChatContext();
  const isActiveChat = Boolean(activeChat);
  const chatId = isActiveChat ? activeChat!.id : chatIdRef.current;

  const { data: baseAiConfig, isLoading: isBaseAiConfigLoading } = useQuery({
    queryKey: ['ai-config', baseId],
    queryFn: () => getAIConfig(baseId).then(({ data }) => data),
  });

  const { data: chatMessage } = useQuery({
    queryKey: ['chat-message', chatId],
    queryFn: ({ queryKey }) => getChatMessages(baseId, queryKey[1]).then((res) => res.data),
    enabled: isActiveChat,
  });

  const messageMetaMap = useMemo(() => {
    return chatMessage?.messages?.reduce(
      (acc, message) => {
        acc[message.id] = {
          timeCost: message.timeCost,
          usage: message.usage,
        };
        return acc;
      },
      {} as Record<string, IMessageMeta>
    );
  }, [chatMessage]);

  const convertToUIMessages = useMemo<UseChatHelpers['messages']>(() => {
    if (!isActiveChat) {
      return [];
    }
    return (
      chatMessage?.messages?.map((message) => ({
        id: message.id,
        role: message.role as UseChatHelpers['messages'][number]['role'],
        parts: message.parts as UseChatHelpers['messages'][number]['parts'],
        content: '',
        createdAt: new Date(message.createdTime),
      })) ?? []
    );
  }, [isActiveChat, chatMessage]);

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

  const useChatRef = useRef({
    isActiveChat,
    chatId,
  });

  useEffect(() => {
    useChatRef.current = {
      isActiveChat,
      chatId,
    };
  }, [isActiveChat, chatId]);

  const { messages, setMessages, handleSubmit, input, setInput, status, stop, data, setData } =
    useChat({
      id: chatId,
      api: `/api/base/${baseId}/chat`,
      initialMessages: convertToUIMessages,
      body: {
        chatId,
        model: validModelKey,
        context,
      },
      onFinish: () => {
        const { isActiveChat, chatId } = useChatRef.current;
        if (isActiveChat) {
          queryClient.invalidateQueries({ queryKey: ['chat-message', chatId] });
          return;
        }
        queryClient.refetchQueries({ queryKey: ReactQueryKeys.chatHistory(baseId) }).then(() => {
          setActiveChatId(chatId);
          chatIdRef.current = generateChatId();
        });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    });

  useEffect(() => {
    if (status === 'streaming' && !isActiveChat) {
      setActiveChatId(chatId);
      queryClient.refetchQueries({ queryKey: ReactQueryKeys.chatHistory(baseId) }).then(() => {
        setActiveChatId(chatId);
        chatIdRef.current = generateChatId();
      });
    }
  }, [status, setActiveChatId, chatId, isActiveChat, queryClient, baseId]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden pb-3">
      <ChatThreadProvider dataStream={data} setDataStream={setData}>
        <Messages
          messages={messages}
          messageMetaMap={messageMetaMap}
          chatId={chatId}
          status={status}
        />
      </ChatThreadProvider>
      <MessageInput
        modelKey={validModelKey}
        models={models}
        input={input}
        setInput={setInput}
        status={status}
        stop={stop}
        setModelKey={setModelKey}
        setMessages={setMessages}
        handleSubmit={handleSubmit}
        modelLoading={isBaseAiConfigLoading}
      />
    </div>
  );
};
