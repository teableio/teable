import type { UseChatHelpers } from '@ai-sdk/react';
import { cn } from '@teable/ui-lib/shadcn';
import { TeableLogo } from '@/components/TeableLogo';
import { useBrand } from '@/features/app/hooks/useBrand';
import { LoadingDot } from './LoadingDot';
import { ReasonMessagePart } from './message-part/ReasonMessagePart';
import { TextMessagePart } from './message-part/TextMessagePart';
import { ToolMessagePart } from './message-part/ToolMessagePart';
import { MessageMeta } from './MessageMeta';
import type { IMessageMeta } from './types';

export const THINKING_MESSAGE_ID = 'thinking';

interface IMessage {
  isLoading?: boolean;
  message: UseChatHelpers['messages'][number];
  meta?: IMessageMeta;
}

export const Message = ({ message, isLoading, meta }: IMessage) => {
  const partsLength = message.parts.length;

  return (
    <MessageWrapper message={message}>
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
            return <ToolMessagePart key={index} part={part} id={`${message.id}-tool-${index}`} />;
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
  const { brandName } = useBrand();

  return (
    <div className="group/message" data-role={message.role}>
      {message.role === 'assistant' && (
        <div className="flex items-center gap-2 pb-1">
          <TeableLogo className="size-4 text-black" />
          <span className="text-sm font-medium">{brandName}</span>
        </div>
      )}
      <div className="flex gap-4 group-data-[role=user]/message:ml-14">
        <div
          className={cn('flex w-full overflow-hidden flex-col gap-4', {
            'w-fit ml-auto overflow-hidden rounded-xl !bg-muted px-3 py-2': message.role === 'user',
          })}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
