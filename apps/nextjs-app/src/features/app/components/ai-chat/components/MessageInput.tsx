import type { UseChatHelpers } from '@ai-sdk/react';
import { ArrowUpRight, Plus } from '@teable/icons';
import { useBase } from '@teable/sdk/hooks';
import { Button, cn, Textarea } from '@teable/ui-lib/shadcn';
import { PauseIcon } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { LoadingDot } from './common/LoadingDot';
import { MessageContext } from './MessageContext';
import { ModelSelector } from './ModelSelector';

export const MessageInput = ({
  modelKey,
  models,
  modelLoading,
  input,
  status,
  textareaClassName,
  setInput,
  stop,
  setModelKey,
  setMessages,
  handleSubmit,
}: {
  modelKey: string;
  models: { modelKey: string; isInstance?: boolean }[];
  modelLoading?: boolean;
  status: UseChatHelpers['status'];
  input: UseChatHelpers['input'];
  textareaClassName?: string;
  setInput: UseChatHelpers['setInput'];
  stop: () => void;
  setModelKey: (modelKey: string) => void;
  setMessages: UseChatHelpers['setMessages'];
  handleSubmit: UseChatHelpers['handleSubmit'];
}) => {
  const { t } = useTranslation(['table']);
  const router = useRouter();
  const base = useBase();

  const hasModel = models.length > 0;

  const hasRequesting = ['submitted', 'streaming'].includes(status);

  const disabledSubmit = input.length === 0 || !hasModel || hasRequesting;

  const onLinkIntegration = () => {
    router.push({
      pathname: '/space/[spaceId]/setting/integration',
      query: { spaceId: base.spaceId },
    });
  };

  return (
    <div className="rounded-lg border bg-muted px-2 py-1">
      <MessageContext />
      <Textarea
        placeholder={t('table:aiChat.inputPlaceholder')}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        className={cn(
          'h-20 resize-none border-none bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0',
          textareaClassName
        )}
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
          <div className="flex items-center gap-2 text-xs text-destructive">
            <Button
              variant="outline"
              size="xs"
              className="h-5 px-[2px] text-xs text-muted-foreground"
              onClick={(e) => {
                e.preventDefault();
                onLinkIntegration();
              }}
            >
              <Plus className="size-4" />
            </Button>
            {t('table:aiChat.noModel')}
          </div>
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
  );
};
