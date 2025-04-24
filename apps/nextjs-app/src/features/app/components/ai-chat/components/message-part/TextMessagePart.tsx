import type { UseChatHelpers } from '@ai-sdk/react';
import { Markdown } from './Markdown';

type ITextPart = UseChatHelpers['messages'][number]['parts'][number] & {
  type: 'text';
};

interface ITextMessagePart {
  className?: string;
  part: ITextPart;
}

export const TextMessagePart = ({ part, className }: ITextMessagePart) => {
  if (!part.text) {
    return;
  }
  return <Markdown className={className}>{part.text}</Markdown>;
};
