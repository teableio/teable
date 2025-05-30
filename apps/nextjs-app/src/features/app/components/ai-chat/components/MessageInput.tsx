import type { UseChatHelpers } from '@ai-sdk/react';
import { ArrowUpRight } from '@teable/icons';
import { Button, Textarea } from '@teable/ui-lib/shadcn';
import { PauseIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useChatStore } from '../store/useChatStore';
import { LoadingDot } from './LoadingDot';
import { MessageContext } from './MessageContext';
import { ModelSelector } from './ModelSelector';

export const MessageInput = ({
  modelKey,
  models,
  modelLoading,
  input,
  setInput,
  status,
  stop,
  setMessages,
  handleSubmit,
}: {
  modelKey: string;
  models: { modelKey: string; isInstance?: boolean }[];
  modelLoading?: boolean;
  status: UseChatHelpers['status'];
  input: UseChatHelpers['input'];
  setInput: UseChatHelpers['setInput'];
  stop: () => void;
  setMessages: UseChatHelpers['setMessages'];
  handleSubmit: UseChatHelpers['handleSubmit'];
}) => {
  const { t } = useTranslation(['table']);
  const { setModelKey } = useChatStore();

  const hasModel = models.length > 0;

  const hasRequesting = ['submitted', 'streaming'].includes(status);

  const disabledSubmit = input.length === 0 || !hasModel || hasRequesting;

  return (
    <form className="px-2">
      <div className="rounded-lg border bg-muted px-2 py-1">
        <MessageContext />
        <Textarea
          placeholder={t('table:aiChat.inputPlaceholder')}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="h-20 resize-none border-none bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
          rows={2}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();

              if (!disabledSubmit) {
                handleSubmit();
              }
            }
          }}
        />
        <div className="flex h-8 items-center justify-between gap-2 pb-1">
          {hasModel ? (
            <ModelSelector models={models} value={modelKey} onValueChange={setModelKey} />
          ) : modelLoading ? (
            <LoadingDot dotClassName="size-0.5" />
          ) : (
            <div className="text-xs text-destructive">{t('table:aiChat.noModel')}</div>
          )}
          {hasRequesting ? (
            <Button
              size={'xs'}
              onClick={(event) => {
                event.preventDefault();
                stop();
                setMessages((messages) => messages);
              }}
            >
              <PauseIcon size={14} />
            </Button>
          ) : (
            <Button
              size={'xs'}
              className="h-auto py-1"
              onClick={(event) => {
                event.preventDefault();
                handleSubmit();
              }}
              disabled={disabledSubmit}
            >
              <ArrowUpRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
};
