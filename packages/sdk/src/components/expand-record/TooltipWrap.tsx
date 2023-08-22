import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable-group/ui-lib';
import type { FC, PropsWithChildren } from 'react';

export const TooltipWrap: FC<PropsWithChildren<{ description: string; disabled?: boolean }>> = (
  props
) => {
  const { description, disabled, children } = props;
  if (disabled) {
    return <>{children}</>;
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>
          <p>{description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
