import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib/shadcn';
import { Clock, Cpu } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { IMessageMeta } from './types';

export function MessageMeta({ meta }: { meta?: IMessageMeta }) {
  const { timeCost, usage } = meta ?? {};
  const { t } = useTranslation(['table', 'common']);
  if (!meta || (!timeCost && !usage)) return;

  const timeCostInSeconds = timeCost ? (timeCost / 1000).toFixed(1) : undefined;
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {timeCostInSeconds && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1">
                <Clock className="size-3" />
                <span>
                  {timeCostInSeconds}
                  {t('table:aiChat.meta.timeCostUnit')}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('table:aiChat.meta.timeCostDescription', { timeCost: timeCostInSeconds })}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {usage?.credit && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1">
                <Cpu className="size-3" />
                <span>
                  {usage.credit} {t('common:noun.credits')}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('table:aiChat.meta.creditDescription', { credits: usage.credit })}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {!usage?.credit && usage?.promptTokens && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1">
                <Cpu className="size-3" />
                <span>{usage.promptTokens + usage.completionTokens} tokens</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {t('table:aiChat.meta.tokenDescription', {
                  tokens: usage.promptTokens + usage.completionTokens,
                })}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
