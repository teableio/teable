import type { UseChatHelpers } from '@ai-sdk/react';
import { ArrowUpRight } from '@teable/icons';
import { Button, Textarea } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { PauseIcon } from 'lucide-react';

export const MessageInput = ({
  input,
  setInput,
  status,
  stop,
  setMessages,
  handleSubmit,
}: {
  input: UseChatHelpers['input'];
  setInput: UseChatHelpers['setInput'];
  status: UseChatHelpers['status'];
  stop: () => void;
  setMessages: UseChatHelpers['setMessages'];
  handleSubmit: UseChatHelpers['handleSubmit'];
}) => {
  return (
    <form className="mx-auto flex w-full items-center gap-2 bg-background px-4 pb-4 md:max-w-3xl md:pb-6">
      <Textarea
        data-testid="multimodal-input"
        placeholder="Send a message..."
        value={input}
        onChange={(event) => setInput(event.target.value)}
        className="max-h-[calc(75dvh)] min-h-[24px] resize-none overflow-hidden rounded-2xl bg-muted pb-10 !text-base dark:border-zinc-700"
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
      <div className="flex w-fit flex-row justify-end p-2">
        {status === 'submitted' ? (
          <Button
            data-testid="stop-button"
            className="h-fit rounded-full border p-1.5 dark:border-zinc-600"
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
            data-testid="send-button"
            className="h-fit rounded-full border p-1.5 dark:border-zinc-600"
            onClick={(event) => {
              event.preventDefault();
              handleSubmit();
            }}
            disabled={input.length === 0}
          >
            <ArrowUpRight className="size-4" />
          </Button>
        )}
      </div>
    </form>
  );
};
