import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib';
import { useTranslation } from '../context/app/i18n';
import { usePersonalView, useView } from '../hooks';

export const ReadOnlyTip = () => {
  const view = useView();
  const { isPersonalView } = usePersonalView();

  const readOnly = view?.isLocked && !isPersonalView;
  const { t } = useTranslation();

  if (!readOnly) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={'absolute inset-0 z-50 cursor-not-allowed'} />
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('common.readOnlyTip')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
