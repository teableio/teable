import type { IDataDbConnectionSummaryVo } from '@teable/openapi';
import {
  Badge,
  cn,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { spaceConfig } from '@/features/i18n/space.config';

export const DataDbBadge = ({
  dataDb,
  className,
}: {
  dataDb?: IDataDbConnectionSummaryVo;
  className?: string;
}) => {
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  if (dataDb?.mode !== 'byodb') {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        {/* Badge is not a forwardRef component, so anchor the tooltip on a span */}
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0">
            <Badge
              variant="outline"
              className={cn(
                'cursor-default border-none bg-emerald-500/10 font-normal text-emerald-700 dark:text-emerald-300',
                className
              )}
            >
              {t('space:dataDb.badge.label')}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent className="max-w-[320px]">
            {t('space:dataDb.badge.tooltip')}
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
};
