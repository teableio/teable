import type { UseChatHelpers } from '@ai-sdk/react';
import { ArrowUpRight } from '@teable/icons';
import { Button, Textarea } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { PauseIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useChatStore } from '../store/useChatStore';
import { MessageContext } from './MessageContext';
import { ModelSelector } from './ModelSelector';

export const MessageInput = ({
  modelKey,
  models,
  input,
  setInput,
  status,
  stop,
  setMessages,
  handleSubmit,
}: {
  modelKey: string;
  models: { modelKey: string; isInstance?: boolean }[];
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

              if (status !== 'ready') {
                toast.error('Please wait for the model to finish its response!');
              } else {
                handleSubmit();
              }
            }
          }}
        />
        <div className="flex items-center justify-between gap-2 pb-1">
          {hasModel ? (
            <ModelSelector models={models} value={modelKey} onValueChange={setModelKey} />
          ) : (
            <div className="text-xs text-destructive">{t('table:aiChat.noModel')}</div>
          )}
          {status === 'submitted' ? (
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
              disabled={input.length === 0 || !hasModel}
            >
              <ArrowUpRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
};
