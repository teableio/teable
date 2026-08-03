import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib';

import { Trans } from '../context/app/i18n';
import { usePersonalView, useView } from '../hooks';

export const ReadOnlyTip = () => {
  const view = useView();
  const { isPersonalView, openPersonalView } = usePersonalView();

  const readOnly = view?.isLocked && !isPersonalView;

  if (!readOnly) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={'absolute inset-0 z-50 cursor-not-allowed'} />
        </TooltipTrigger>
        <TooltipContent className="max-w-[360px]">
          <span className="whitespace-normal break-words text-xs leading-normal">
            <Trans
              i18nKey="common.readOnlyTip"
              components={{
                button: (
                  <button
                    type="button"
                    className="inline px-1 text-xs leading-normal text-secondary underline"
                    onClick={openPersonalView}
                  />
                ),
              }}
            />
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
