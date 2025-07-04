import type { UseChatHelpers } from '@ai-sdk/react';
import { isEqual } from 'lodash';
import { memo } from 'react';
import { Markdown } from '../common/Markdown';

type ITextPart = UseChatHelpers['messages'][number]['parts'][number] & {
  type: 'text';
};

interface ITextMessagePart {
  id: string;
  className?: string;
  part: ITextPart;
}

export const PureTextMessagePart = ({ id, part, className }: ITextMessagePart) => {
  if (!part.text) {
    return;
  }
  return (
    <Markdown id={id} className={className}>
      {part.text}
    </Markdown>
  );
};

export const TextMessagePart = memo(PureTextMessagePart, (prev, next) => {
  return isEqual(prev.part, next.part);
});
