import { countTextTokens, getRandomString } from '@teable-group/core';
import { first, last } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import type { IMessage } from 'store/message';
import { MessageStatus, CreatorRole, useMessageStore } from 'store/message';
import type { IUser } from 'store/user';
import { MessageInput } from './MessageInput';
import { MessageView } from './MessageView';
import type { IChat } from './type';
import { useGPTRequest } from './useGPTRequest';

// The maximum number of tokens that can be sent to the OpenAI API.
// reference: https://platform.openai.com/docs/api-reference/completions/create#completions/create-max_tokens
const maxTokens = 4000;

const getDefaultChat = (): IChat => {
  return {
    id: getRandomString(20),
    assistantId: 'sql-assistant',
    title: 'New Chart',
    createdAt: Date.now(),
  };
};

// Assistant is a special user.
export const assistantList: IUser[] = [
  {
    id: 'sql-assistant',
    name: 'Copilot',
    description: "🤖️ I'm an expert in SQL. I can answer your questions about databases and SQL.",
    avatar: '',
  },
];

export const getAssistantById = (id: string) => {
  const user = assistantList.find((user) => user.id === id);
  return user || (first(assistantList) as IUser);
};

// getPromptOfAssistant define the special prompt for each assistant.
export const getPromptGeneratorOfAssistant = (assistant: IUser) => {
  const basicPrompt = `Please follow the instructions to answer the questions:
1. Set the language to the markdown code block for each code block. For example, \`SELECT * FROM table\` is SQL.
2. Please be careful to return only key information, and try not to make it too long.
`;
  if (assistant.id === 'sql-assistant') {
    return (schema: string) =>
      `This is my database schema"${schema}". You will see the tables and columns in the database. And please answer the following questions about the database.\n${basicPrompt}`;
  }
  return () => `\n${basicPrompt}`;
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
  }, [lastMessage?.status, lastMessage?.content]);

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
    let prompt = '';
    let tokens = 0;
    console.log('sendMessageToCurrentChat:messageList:', messageList);
    const promptGenerator = getPromptGeneratorOfAssistant(getAssistantById(chat.assistantId)!);
    prompt = promptGenerator('');
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

    const message: IMessage = {
      id: getRandomString(20),
      chatId: chat.id,
      creatorId: chat.assistantId,
      creatorRole: CreatorRole.Assistant,
      createdAt: Date.now(),
      content: '',
      status: MessageStatus.Loading,
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
      className="drawer-content relative w-full h-full max-h-full flex flex-col justify-start items-start overflow-y-auto bg-base-100"
    >
      <div className="p-2 w-full h-auto grow max-w-4xl py-1 px-4 sm:px-8 mx-auto">
        {messageList.length === 0 ? (
          <p>Empty</p>
        ) : (
          messageList.map((message) => <MessageView key={message.id} message={message} />)
        )}
        {isLoading && <p>Loading</p>}
      </div>
      <div className="sticky bottom-0 w-full max-w-4xl py-2 px-4 sm:px-8 mx-auto bg-base-100 backdrop-blur">
        <MessageInput disabled={isLoading} sendMessage={sendMessageToCurrentChat} chat={chat} />
      </div>
    </main>
  );
};
