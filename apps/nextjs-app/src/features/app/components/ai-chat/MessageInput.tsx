import { getRandomString } from '@teable-group/core';
import SendIcon from '@teable-group/ui-lib/icons/app/send.svg';
import { message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { CreatorRole, MessageStatus, useMessageStore } from 'store/message';
import type { IChat } from './type';

interface Props {
  disabled?: boolean;
  sendMessage: () => Promise<void>;
  chat: IChat;
}

export const MessageInput: React.FC<Props> = ({ disabled, sendMessage, chat }) => {
  const [value, setValue] = useState<string>('');
  const [isInIME, setIsInIME] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageStore = useMessageStore();
  const [messageApi, contextHolder] = message.useMessage();
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
  };

  const handleSend = async () => {
    if (!value) {
      messageApi.info('Please enter a message.');
      return;
    }
    if (disabled) {
      return;
    }

    messageStore.addMessage({
      id: getRandomString(20),
      chatId: chat.id,
      creatorId: 'default-user',
      creatorRole: CreatorRole.User,
      createdAt: Date.now(),
      content: value,
      status: MessageStatus.Done,
    });
    setValue('');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    textareaRef.current!.value = '';
    await sendMessage();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey && !isInIME) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-full h-auto flex flex-row justify-between items-end border rounded-lg mb-2 p-1 relative shadow bg-base-100">
      <TextareaAutosize
        ref={textareaRef}
        className="hide-scrollbar w-full h-full textarea bg-transparent leading-6 p-1 mr-1 resize-none text-sm min-h-0"
        placeholder="Type a message..."
        rows={1}
        minRows={1}
        maxRows={5}
        onCompositionStart={() => setIsInIME(true)}
        onCompositionEnd={() => setIsInIME(false)}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {contextHolder}
      <button
        className="w-8 p-1 -translate-y-1 cursor-pointer rounded-md hover:shadow hover:bg-base-300 disabled:cursor-not-allowed disabled:opacity-60 text-[18px]"
        disabled={disabled}
        onClick={handleSend}
      >
        <SendIcon />
      </button>
    </div>
  );
};
