import { getRandomString } from '@teable/core';
import SendIcon from '@teable/ui-lib/icons/app/send.svg';
import { useToast } from '@teable/ui-lib/shadcn/ui/use-toast';
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
  const { toast } = useToast();
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
      toast({ description: 'Please enter a message.' });
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
    <div className="bg-base-100 relative mb-2 flex h-auto w-full flex-row items-end justify-between rounded-lg border p-1 shadow">
      <TextareaAutosize
        ref={textareaRef}
        className="hide-scrollbar textarea mr-1 size-full min-h-0 resize-none bg-transparent p-1 text-sm leading-6"
        placeholder="Type a message..."
        rows={1}
        minRows={1}
        maxRows={5}
        onCompositionStart={() => setIsInIME(true)}
        onCompositionEnd={() => setIsInIME(false)}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      <button
        className="hover:bg-base-300 w-8 -translate-y-1 cursor-pointer rounded-md p-1 text-[18px] hover:shadow disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={handleSend}
      >
        <SendIcon />
      </button>
    </div>
  );
};
