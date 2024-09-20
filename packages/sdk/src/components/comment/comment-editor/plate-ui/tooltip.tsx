'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { withCn, withProps } from '@udecode/cn';
import React from 'react';

export const TooltipProvider = TooltipPrimitive.Provider;

export const Tooltip = TooltipPrimitive.Root;

export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipPortal = TooltipPrimitive.Portal;

export const TooltipContent = withCn(
  withProps(TooltipPrimitive.Content, {
    sideOffset: 4,
  }),
  'z-50 overflow-hidden rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-950 shadow-md dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50'
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withTooltip<T extends React.ComponentType<any> | keyof HTMLElementTagNameMap>(
  Component: T
) {
  return React.forwardRef<
    React.ElementRef<T>,
    {
      tooltip?: React.ReactNode;
      tooltipContentProps?: Omit<
        React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
        'children'
      >;
      tooltipProps?: Omit<React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>, 'children'>;
    } & React.ComponentPropsWithoutRef<T>
  >(function ExtendComponent({ tooltip, tooltipContentProps, tooltipProps, ...props }, ref) {
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
      setMounted(true);
    }, []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const component = <Component ref={ref} {...(props as any)} />;

    if (tooltip && mounted) {
      return (
        <Tooltip {...tooltipProps}>
          <TooltipTrigger asChild>{component}</TooltipTrigger>

          <TooltipPortal>
            <TooltipContent {...tooltipContentProps}>{tooltip}</TooltipContent>
          </TooltipPortal>
        </Tooltip>
      );
    }

    return component;
  });
}
