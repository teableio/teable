import { getRandomString } from '@teable/core';
import { first, last } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import type { IMessage } from 'store/message';
import { MessageStatus, CreatorRole, useMessageStore } from 'store/message';
import type { IUser } from 'store/user';
import { MessageInput } from './MessageInput';
import { MessageView } from './MessageView';
import { getPromptGeneratorOfAssistant } from './prompt/getPromptGenerator';
import type { IChat } from './type';
import { countTextTokens, useGPTRequest } from './useGPTRequest';

// The maximum number of tokens that can be sent to the OpenAI API.
// reference: https://platform.openai.com/docs/api-reference/completions/create#completions/create-max_tokens
const maxTokens = 4000;

const getDefaultChat = (): IChat => {
  return {
    id: getRandomString(20),
    assistantId: 'tai-app',
    title: 'New Chart',
    createdAt: Date.now(),
  };
};

// Assistant is a special user.
export const assistantList: IUser[] = [
  {
    id: 'tai-app',
    name: 'Tai',
    description: "🤖️ I'm your AI assistant Tai, your copilot of work in teable.",
    avatar: '',
  },
];

export const getAssistantById = (id: string) => {
  const user = assistantList.find((user) => user.id === id);
  return user || (first(assistantList) as IUser);
};

export const ChatWindow = () => {
  const messageStore = useMessageStore();
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const [chat] = useState(getDefaultChat);
  const messageList = messageStore.messageList.filter((message) => message.chatId === chat?.id);
  const lastMessage = last(messageList);
  const { isLoading, fetchChatGPTResponse } = useGPTRequest();

  useEffect(() => {
    setTimeout(() => {
      if (!chatWindowRef.current) {
        return;
      }
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
    });
  }, [chat, messageList.length, lastMessage?.status]);

  useEffect(() => {
    setTimeout(() => {
      if (!chatWindowRef.current) {
        return;
      }
      if (!lastMessage) {
        return;
      }

      if (lastMessage.status !== MessageStatus.Done) {
        chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
      }
    });
  }, [lastMessage]);

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const sendMessageToCurrentChat = async () => {
    if (!chat) {
      return;
    }
    if (isLoading) {
      return;
    }

    const messageList = messageStore
      .getState()
      .messageList.filter((message) => message.chatId === chat.id);
    let tokens = 0;
    console.log('sendMessageToCurrentChat:messageList:', messageList);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const promptGenerator = getPromptGeneratorOfAssistant(getAssistantById(chat.assistantId)!);
    const messageType = messageList[messageList.length - 1].content.match(/chart|图/gi)
      ? 'chart'
      : 'table';
    const prompt = await promptGenerator(messageList[messageList.length - 1].content, messageType);
    console.log('sendMessageToCurrentChat:prompt:', prompt);
    const formatedMessageList = [];
    for (let i = messageList.length - 1; i >= 0; i--) {
      const message = messageList[i];
      if (tokens < maxTokens) {
        tokens += countTextTokens(message.content);
        formatedMessageList.unshift({
          role: message.creatorRole,
          content: message.content,
        });
      }
    }
    formatedMessageList.unshift({
      role: CreatorRole.System,
      content: prompt,
    });

    const messageId = getRandomString(20);
    const message: IMessage = {
      id: messageId,
      chatId: chat.id,
      creatorId: chat.assistantId,
      creatorRole: CreatorRole.Assistant,
      createdAt: Date.now(),
      content: '',
      status: MessageStatus.Loading,
      type: messageType,
    };

    messageStore.addMessage(message);

    fetchChatGPTResponse(formatedMessageList, (content, done, err) => {
      messageStore.updateMessage(message.id, {
        content,
      });
      if (err) {
        messageStore.updateMessage(message.id, {
          status: MessageStatus.Failed,
        });
      }
      if (done) {
        messageStore.updateMessage(message.id, {
          status: MessageStatus.Done,
        });
      }
    });
  };

  return (
    <main
      ref={chatWindowRef}
      className="drawer-content relative flex h-full basis-[300px] flex-col items-start justify-start overflow-y-auto"
    >
      <div className="mx-auto h-auto w-full max-w-4xl grow p-2">
        {messageList.length === 0 ? (
          <div className="flex flex-col items-center justify-center">
            <p>What can I do for you?</p>
          </div>
        ) : (
          messageList.map((message) => (
            <MessageView chat={chat} key={message.id} message={message} />
          ))
        )}
        {isLoading && <p>...</p>}
      </div>
      <div className="bg-base-100 sticky bottom-0 mx-auto w-full max-w-4xl p-2 backdrop-blur">
        <MessageInput disabled={isLoading} sendMessage={sendMessageToCurrentChat} chat={chat} />
      </div>
    </main>
  );
};
