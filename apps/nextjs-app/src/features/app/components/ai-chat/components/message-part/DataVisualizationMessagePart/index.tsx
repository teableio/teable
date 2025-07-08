import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from '@teable/icons';
import type {
  IDataVisualizationAgentResult,
  IDataVisualizationDataStream,
  IDataVisualizationParameters,
} from '@teable/openapi';
import {
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { useChatThreadContext } from '@/features/app/components/ai-chat/context/chat-thread/useChatThreadContext';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { LoadingDot } from '../../common/LoadingDot';
import type { IToolMessagePart } from '../types';
import { CodeDialog } from './CodeDialog';
import { CodePreviewImage } from './CodePreviewImage';

const useToolInvocationState = (toolInvocation: IToolMessagePart['part']['toolInvocation']) => {
  const { state } = toolInvocation;
  const isLoading = useMemo(() => {
    return state !== 'result';
  }, [state]);

  const { error, filePath } =
    state === 'result' ? (toolInvocation.result as IDataVisualizationAgentResult) : {};
  return {
    isLoading,
    toolArgs: toolInvocation.args as IDataVisualizationParameters | undefined,
    error,
    filePath,
  };
};

const useDataStreamCode = (
  toolInvocation: IToolMessagePart['part']['toolInvocation'],
  data: unknown[] | undefined
) => {
  const { state } = toolInvocation;
  return useMemo(() => {
    if (state !== 'call') {
      return '';
    }
    if (!data) {
      return '';
    }
    const lastData = data[data.length - 1] as IDataVisualizationDataStream;
    return lastData?.data?.code;
  }, [state, data]);
};

export const DataVisualizationMessagePart = (props: IToolMessagePart) => {
  const { part } = props;
  const { toolInvocation } = part;
  const { dataStream, setDataStream } = useChatThreadContext();
  const [open, setOpen] = useState(false);
  const { t } = useTranslation(['table']);
  const { isLoading, toolArgs, filePath, error } = useToolInvocationState(toolInvocation);

  const previewUrl = usePreviewUrl();
  const url = filePath ? previewUrl(filePath) : '';

  const streamCode = useDataStreamCode(toolInvocation, dataStream);
  const { data: fileCode } = useQuery({
    queryKey: ['file', url],
    queryFn: async () => {
      const file = await fetch(url);
      return await file.text();
    },
    enabled: !!url && !streamCode,
  });

  const codeStat = useMemo(
    () => streamCode?.split('\n').filter(Boolean).slice(-3) ?? [],
    [streamCode]
  );

  useEffect(() => {
    if (!isLoading && codeStat.length === 0) {
      setDataStream([]);
    }
  }, [isLoading, codeStat, setDataStream]);

  return (
    <div
      className={cn('flex h-16 items-center justify-center p-2 rounded-lg border-[1.5px]', {
        'border-green-500 bg-green-100': !isLoading,
        'animate-pulse': isLoading,
        'border-red-500 bg-red-100': error,
      })}
    >
      <div className="size-full overflow-hidden">
        {!error && isLoading ? (
          <div
            className={cn('flex h-full flex-col justify-end overflow-hidden px-5', {
              'justify-center items-center': codeStat.length === 0,
            })}
          >
            <div className="space-y-2">
              {codeStat.map((line, index) => (
                <pre
                  key={`${line}-${index}`}
                  className="flex-1 truncate text-center text-xs transition-all duration-300"
                >
                  {line}
                </pre>
              ))}
              {codeStat.length === 0 && (
                <div className="text-center text-xs">
                  <LoadingDot />
                </div>
              )}
            </div>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center gap-1 text-xs text-red-500">
            {t('table:aiChat.dataVisualization.error')}
            <TooltipProvider key={toolInvocation.toolCallId} delayDuration={200}>
              <Tooltip>
                <TooltipTrigger>
                  <AlertCircle className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent className="w-60">
                  <div className="break-all">{error}</div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ) : (
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
          <div
            className="flex size-full cursor-pointer items-center gap-2"
            onClick={() => setOpen(true)}
          >
            <div className="h-12 w-[68px]">
              <CodePreviewImage code={fileCode} alt="Data Visualization" />
            </div>
            <div
              className="line-clamp-2 flex-1 text-sm font-medium text-slate-600"
              title={toolArgs?.title}
            >
              {toolArgs?.title}
            </div>
          </div>
        )}
      </div>
      <CodeDialog code={fileCode} open={open} onOpenChange={setOpen} />
    </div>
  );
};
