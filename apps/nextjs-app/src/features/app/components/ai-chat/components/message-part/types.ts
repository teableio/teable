import type { UseChatHelpers } from '@ai-sdk/react';

export interface IToolMessagePart {
  id: string;
  chatId: string;
  part: UseChatHelpers['messages'][number]['parts'][number] & {
    type: 'tool-invocation';
  };
}
