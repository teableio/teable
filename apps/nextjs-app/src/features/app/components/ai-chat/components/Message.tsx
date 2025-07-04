import type { UseChatHelpers } from '@ai-sdk/react';
import { UserAvatar } from '@teable/sdk/components';
import { useSession } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { BotIcon } from 'lucide-react';
import { LoadingDot } from './common/LoadingDot';
import { ReasonMessagePart } from './message-part/ReasonMessagePart';
import { TextMessagePart } from './message-part/TextMessagePart';
import { ToolMessagePart } from './message-part/ToolMessagePart';
import { MessageMeta } from './MessageMeta';
import type { IMessageMeta } from './types';

export const THINKING_MESSAGE_ID = 'thinking';

interface IMessage {
  isLoading?: boolean;
  chatId: string;
  message: UseChatHelpers['messages'][number];
  meta?: IMessageMeta;
}

export const Message = ({ message, isLoading, meta, chatId }: IMessage) => {
  const partsLength = message.parts.length;

  return (
    <MessageWrapper message={message} chatId={chatId}>
      {message.parts.map((part, index) => {
        switch (part.type) {
          case 'text':
            return (
              <TextMessagePart
                key={index}
                id={`${message.id}-text-${index}`}
                part={part}
                className="group-data-[role=user]/message:!bg-muted"
              />
            );
          case 'reasoning':
            return (
              <ReasonMessagePart
                key={index}
                part={part}
                isLoading={isLoading}
                isLastPart={index === partsLength - 1}
              />
            );
          case 'tool-invocation':
            return (
              <ToolMessagePart
                key={index}
                part={part}
                id={`${message.id}-tool-${index}`}
                chatId={chatId}
              />
            );
          default:
            return;
        }
      })}
      {isLoading && <LoadingDot />}
      <MessageMeta meta={meta} />
    </MessageWrapper>
  );
};

export const MessageWrapper = ({
  message,
  children,
}: IMessage & { children: React.ReactNode | React.ReactNode[] }) => {
  const { user } = useSession();
  return (
    <div className="group/message" data-role={message.role}>
      <div className="flex gap-4 group-data-[role=user]/message:ml-14">
        {message.role === 'assistant' && (
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <BotIcon className="size-4" />
          </div>
        )}
        <div
          className={cn('flex w-full overflow-hidden flex-col gap-4', {
            'w-fit ml-auto overflow-hidden rounded-xl !bg-muted px-3 py-2': message.role === 'user',
          })}
        >
          {children}
        </div>
        {message.role === 'user' && (
          <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <UserAvatar name={user?.name} avatar={user?.avatar} />
          </div>
        )}
      </div>
    </div>
  );
};
