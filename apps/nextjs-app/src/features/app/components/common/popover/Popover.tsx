import * as PopoverPrimitive from '@radix-ui/react-popover';
import React from 'react';

export interface IPopover extends PopoverPrimitive.PopoverPortalProps {
  content: React.ReactNode;
  arrow?: boolean;
  open?: boolean;
}

export const Popover = React.forwardRef(
  (props: IPopover, forwardedRef: React.Ref<HTMLDivElement>) => {
    const { content, children, arrow, open, ...rest } = props;
    return (
      <PopoverPrimitive.Root open={open}>
        <PopoverPrimitive.Trigger asChild>{children}</PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            className="card bg-base-100 p-2 shadow-xl"
            sideOffset={5}
            {...rest}
            ref={forwardedRef}
          >
            {content}
            {arrow && <PopoverPrimitive.Arrow className="fill-base-100" />}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    );
  }
);

Popover.displayName = 'Popover';
