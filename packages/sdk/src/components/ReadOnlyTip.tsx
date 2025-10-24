import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib';

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
        <TooltipContent>
          <span className="text-xs">
            <Trans
              i18nKey="common.readOnlyTip"
              components={{
                button: (
                  <Button
                    className="pl-1 text-xs text-secondary underline"
                    size="xs"
                    onClick={openPersonalView}
                    variant="link"
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
