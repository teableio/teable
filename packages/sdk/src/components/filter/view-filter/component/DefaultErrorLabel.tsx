import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib';
import { useTranslation } from '../../../../context/app/i18n';

export const DefaultErrorLabel = () => {
  const { t } = useTranslation();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="truncate text-red-500">{t('filter.invalidateSelected')}</span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('filter.invalidateSelectedTips')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
