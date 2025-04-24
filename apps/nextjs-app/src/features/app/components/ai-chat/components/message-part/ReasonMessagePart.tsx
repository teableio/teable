import type { UseChatHelpers } from '@ai-sdk/react';

interface IReasonMessagePart {
  part: UseChatHelpers['messages'][number]['parts'][number] & {
    type: 'reasoning';
  };
}

export const ReasonMessagePart = ({ part }: IReasonMessagePart) => {
  return <div>{part.reasoning}</div>;
};
