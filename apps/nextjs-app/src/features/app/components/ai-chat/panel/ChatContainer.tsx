import { useChat } from '@ai-sdk/react';
import type { UseChatOptions, UseChatHelpers } from '@ai-sdk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { generateChatId } from '@teable/core';
import type { IToolInvocationUIPart } from '@teable/openapi';
import { getAIConfig, getChatMessages, McpToolInvocationName } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { generateModelKeyList } from '@/features/app/blocks/admin/setting/components/ai-config/utils';
import { MessageInput } from '../components/MessageInput';
import { Messages } from '../components/Messages';
import type { IMessageMeta } from '../components/types';
import { ChatContext } from '../context/ChatContext';
import { useChatContext } from '../context/useChatContext';
import { useActiveChat } from '../hooks/useActiveChat';
import { useChatStore } from '../store/useChatStore';

export interface ChatContainerRef {
  setInputValue: (value: string) => void;
  submit: () => void;
}

export const ChatContainer = forwardRef<
  ChatContainerRef,
  {
    baseId: string;
    autoOpen?: boolean;
    onToolCall?: (
      toolCall: Parameters<Required<UseChatOptions>['onToolCall']>[0] & { chatId: string }
    ) => void;
  }
>(({ baseId, autoOpen = false, onToolCall }, ref) => {
  const chatIdRef = useRef(generateChatId());
  const { modelKey, setModelKey } = useChatStore();
  const tableIdRef = useRef<string | undefined>();
  const viewIdRef = useRef<string | undefined>();
  const activeChat = useActiveChat(baseId);
  const queryClient = useQueryClient();
  const chatContext = useChatContext();
  const { context, setActiveChatId } = chatContext;
  const isActiveChat = Boolean(activeChat);
  const chatId = isActiveChat ? activeChat!.id : chatIdRef.current;
  const router = useRouter();
  const tableId = router.query.tableId as string | undefined;

  useEffect(() => {
    tableIdRef.current = tableId;
  }, [tableId]);

  useEffect(() => {
    viewIdRef.current = router.query.viewId as string | undefined;
  }, [router.query.viewId]);

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

  const { messages, setMessages, handleSubmit, input, setInput, status, stop, addToolResult } =
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
      onToolCall: ({ toolCall }) => {
        const args = toolCall.args as Record<string, unknown>;
        onToolCall?.({ toolCall, chatId });
        const currentTableId = tableIdRef.current;
        switch (toolCall.toolName) {
          case McpToolInvocationName.CreateFields:
          case McpToolInvocationName.CreateRecords: {
            if ('tableId' in args && args.tableId !== currentTableId) {
              router.push(
                {
                  pathname: `/base/[baseId]/[tableId]/`,
                  query: {
                    baseId,
                    tableId: args.tableId as string,
                  },
                },
                undefined,
                {
                  shallow: Boolean(currentTableId),
                }
              );
            }
            break;
          }
          case McpToolInvocationName.CreateView: {
            setTimeout(() => {
              const { toolCallId } = toolCall;
              const { tableId } = toolCall.args as { tableId: string };
              const partItem = messagesRef?.current
                ?.map(({ parts }) => parts)
                .flat()
                ?.find(
                  (part) =>
                    (part as unknown as IToolInvocationUIPart)?.toolInvocation?.toolCallId ===
                    toolCallId
                );
              const toolInvocation = (partItem as IToolInvocationUIPart)?.toolInvocation;
              if (!toolInvocation) {
                return;
              }
              let createdViewId: string | undefined;
              try {
                const { result } = toolInvocation;
                const createdView = JSON.parse(result?.content?.[0]?.text);
                createdViewId = createdView?.view.id;
              } catch (error) {
                console.error('parse created table error', error);
              }
              if (!createdViewId) {
                return;
              }
              if (createdViewId !== currentTableId) {
                router.push(
                  {
                    pathname: `/base/[baseId]/[tableId]/[viewId]`,
                    query: {
                      baseId,
                      tableId,
                      viewId: createdViewId,
                    },
                  },
                  undefined,
                  {
                    shallow: Boolean(currentTableId),
                  }
                );
              }
            }, 3000);
            break;
          }
          case McpToolInvocationName.CreateTable: {
            setTimeout(() => {
              const { toolCallId } = toolCall;
              const partItem = messagesRef?.current
                ?.map(({ parts }) => parts)
                .flat()
                ?.find(
                  (part) =>
                    (part as unknown as IToolInvocationUIPart)?.toolInvocation?.toolCallId ===
                    toolCallId
                );
              const toolInvocation = (partItem as IToolInvocationUIPart)?.toolInvocation;
              if (!toolInvocation) {
                return;
              }
              let createdTableId: string | undefined;
              try {
                const { result } = toolInvocation;
                const createdTable = JSON.parse(result?.content?.[0]?.text);
                createdTableId = createdTable?.table.id;
                console.log('createdTablecreatedTablecreatedTable', createdTable);
              } catch (error) {
                console.error('createdTablecreatedTablecreatedTable', error);
                console.error('parse created table error', error);
              }
              if (!createdTableId) {
                return;
              }
              if (createdTableId !== currentTableId) {
                router.push(
                  {
                    pathname: `/base/[baseId]/[tableId]/`,
                    query: {
                      baseId,
                      tableId: createdTableId,
                    },
                  },
                  undefined,
                  {
                    shallow: Boolean(currentTableId),
                  }
                );
              }
            }, 3000);
            break;
          }
        }
      },
      onError: (error) => {
        toast.error(error.message);
      },
    });

  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (status === 'streaming' && !isActiveChat) {
      setActiveChatId(chatId);
      queryClient.refetchQueries({ queryKey: ReactQueryKeys.chatHistory(baseId) }).then(() => {
        setActiveChatId(chatId);
        chatIdRef.current = generateChatId();
      });
    }
  }, [status, setActiveChatId, chatId, isActiveChat, queryClient, baseId]);

  useImperativeHandle(ref, () => ({
    setInputValue: (value: string) => {
      setInput(value);
    },
    submit: () => {
      handleSubmit();
    },
  }));

  return (
    <div className="flex w-full flex-1 flex-col overflow-hidden pb-1">
      {(messages.length > 0 || !autoOpen) && (
        <ChatContext.Provider
          value={{
            ...chatContext,
            addToolResult,
          }}
        >
          <div className="flex flex-1 flex-col overflow-hidden pb-1">
            <Messages
              messages={messages}
              messageMetaMap={messageMetaMap}
              chatId={chatId}
              status={status}
            />
            <MessageInput
              messages={messages}
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
        </ChatContext.Provider>
      )}
    </div>
  );
});

ChatContainer.displayName = 'ChatContainer';
