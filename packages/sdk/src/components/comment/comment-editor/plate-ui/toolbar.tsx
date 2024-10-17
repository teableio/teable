'use client';

import * as ToolbarPrimitive from '@radix-ui/react-toolbar';
import { cn, withCn, withRef, withVariants } from '@udecode/cn';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { Icons } from './icons';
import { Separator } from './separator';
import { withTooltip } from './tooltip';

export const Toolbar = withCn(
  ToolbarPrimitive.Root,
  'relative flex select-none items-center gap-1 bg-white dark:bg-slate-950'
);

export const ToolbarToggleGroup = withCn(ToolbarPrimitive.ToolbarToggleGroup, 'flex items-center');

export const ToolbarLink = withCn(
  ToolbarPrimitive.Link,
  'font-medium underline underline-offset-4'
);

export const ToolbarSeparator = withCn(
  ToolbarPrimitive.Separator,
  'my-1 w-px shrink-0 bg-slate-200 dark:bg-slate-800'
);

const toolbarButtonVariants = cva(
  cn(
    'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:ring-offset-slate-950 dark:focus-visible:ring-slate-300',
    '[&_svg:not([data-icon])]:size-5'
  ),
  {
    defaultVariants: {
      size: 'sm',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-10 px-3',
        lg: 'h-11 px-5',
        sm: 'h-9 px-2',
      },
      variant: {
        default:
          'bg-transparent hover:bg-slate-100 hover:text-slate-500 aria-checked:bg-slate-100 aria-checked:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-400 dark:aria-checked:bg-slate-800 dark:aria-checked:text-slate-50',
        outline:
          'border border-slate-200 bg-transparent hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-50',
      },
    },
  }
);

const ToolbarButton = withTooltip(
  // eslint-disable-next-line react/display-name
  React.forwardRef<
    React.ElementRef<typeof ToolbarToggleItem>,
    {
      isDropdown?: boolean;
      pressed?: boolean;
    } & Omit<React.ComponentPropsWithoutRef<typeof ToolbarToggleItem>, 'asChild' | 'value'> &
      VariantProps<typeof toolbarButtonVariants>
  >(({ children, className, isDropdown, pressed, size, variant, ...props }, ref) => {
    return typeof pressed === 'boolean' ? (
      <ToolbarToggleGroup disabled={props.disabled} type="single" value="single">
        <ToolbarToggleItem
          className={cn(
            toolbarButtonVariants({
              size,
              variant,
            }),
            isDropdown && 'my-1 justify-between pr-1',
            className
          )}
          ref={ref}
          value={pressed ? 'single' : ''}
          {...props}
        >
          {isDropdown ? (
            <>
              <div className="flex flex-1">{children}</div>
              <div>
                <Icons.arrowDown className="ml-0.5 size-4" data-icon />
              </div>
            </>
          ) : (
            children
          )}
        </ToolbarToggleItem>
      </ToolbarToggleGroup>
    ) : (
      <ToolbarPrimitive.Button
        className={cn(
          toolbarButtonVariants({
            size,
            variant,
          }),
          isDropdown && 'pr-1',
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </ToolbarPrimitive.Button>
    );
  })
);
ToolbarButton.displayName = 'ToolbarButton';

export { ToolbarButton };

export const ToolbarToggleItem = withVariants(ToolbarPrimitive.ToggleItem, toolbarButtonVariants, [
  'variant',
  'size',
]);

export const ToolbarGroup = withRef<
  'div',
  {
    noSeparator?: boolean;
  }
>(({ children, className, noSeparator }, ref) => {
  const childArr = React.Children.map(children, (c) => c);

  if (!childArr || childArr.length === 0) return null;

  return (
    <div className={cn('flex', className)} ref={ref}>
      {!noSeparator && (
        <div className="h-full py-1">
          <Separator orientation="vertical" />
        </div>
      )}

      <div className="mx-1 flex items-center gap-1">{children}</div>
    </div>
  );
});

export const FixedToolbar = withCn(
  Toolbar,
  'supports-backdrop-blur:bg-background/60 sticky left-0 top-0 z-50 w-full justify-between overflow-x-auto rounded-t-lg border-b border-b-border bg-background/95 backdrop-blur'
);
