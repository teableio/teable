import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib';

import { Trans } from '../context/app/i18n';
import { usePersonalView, useView } from '../hooks';
import { useInDrawer } from './adaptive-panel/DrawerStackContext';

export const ReadOnlyTip = () => {
  const view = useView();
  const { isPersonalView, openPersonalView } = usePersonalView();
  const inDrawer = useInDrawer();

  const readOnly = view?.isLocked && !isPersonalView;

  if (!readOnly) {
    return null;
  }

  const explanation = (
    <Trans
      i18nKey="common.readOnlyTip"
      components={{
        button: (
          <button
            type="button"
            className="inline px-1 text-xs leading-normal underline"
            onClick={openPersonalView}
          />
        ),
      }}
    />
  );

  if (inDrawer) {
    // A phone has no hover, so the hover-only tooltip would leave the user
    // facing a panel that silently swallows every tap. State the reason in
    // place instead, and keep the "personal mode" escape hatch tappable.
    // Still `absolute inset-0`, so it covers the panel body but not the
    // drawer header - the close button stays reachable.
    return (
      <div className="absolute inset-0 z-50 cursor-not-allowed overflow-y-auto bg-background/70">
        <div className="m-4 rounded-md border border-border bg-muted p-3">
          <span className="cursor-auto whitespace-normal break-words text-xs leading-normal text-muted-foreground">
            {explanation}
          </span>
        </div>
      </div>
    );
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
