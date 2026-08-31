'use client';

import * as DrawerPrimitive from '@radix-ui/react-dialog';
import { Cross2Icon } from '@radix-ui/react-icons';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../utils';

/**
 * Bottom drawer built directly on @radix-ui/react-dialog.
 *
 * Deliberately not built on `Sheet`: `Sheet` always renders its corner
 * `Close` element (only the icon inside it is conditional), which leaves an
 * invisible click target in the top-right corner even when `closeable` is
 * false. Here the close affordance lives inside `DrawerHeader` and is only
 * rendered when it is actually usable.
 */
const Drawer = DrawerPrimitive.Root;

const DrawerTrigger = DrawerPrimitive.Trigger;

const DrawerClose = DrawerPrimitive.Close;

const DrawerPortal = DrawerPrimitive.Portal;

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    data-slot="drawer-overlay"
    className={cn(
      // Light mode uses the 20% scrim from the spec. Dark pages need a
      // heavier scrim: at 20% over a near-black page the drawer edge is the
      // only thing separating panel from page.
      'fixed inset-0 z-50 bg-black/20 dark:bg-black/60',
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      'data-[state=closed]:duration-300 data-[state=open]:duration-500',
      'motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none',
      className
    )}
    {...props}
  />
));
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName;

const drawerVariants = cva(
  cn(
    'fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden',
    // Top corners only - the panel is flush with the bottom edge of the screen.
    'rounded-t-xl border-t bg-background shadow-lg',
    // Never full screen: the uncovered strip of overlay above the drawer is
    // the affordance that tells the user they can tap out.
    'max-h-[85dvh]',
    'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
    'data-[state=closed]:duration-300 data-[state=open]:duration-500',
    // Scoped to the same data-attribute selectors as the animations above:
    // a bare `motion-reduce:animate-none` is (0,1,0) and loses to
    // `data-[state=open]:animate-in` at (0,2,0), so it never applied.
    'motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none'
  ),
  {
    variants: {
      size: {
        // Height follows content, capped by max-h.
        auto: '',
        // Fixed height for search-filtered option lists, so the panel does
        // not resize on every keystroke.
        list: 'h-[60dvh]',
      },
    },
    defaultVariants: {
      size: 'auto',
    },
  }
);

interface IDrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>,
    VariantProps<typeof drawerVariants> {
  container?: HTMLElement | null;
  overlayClassName?: string;
}

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  IDrawerContentProps
>(({ className, children, container, size, overlayClassName, onOpenAutoFocus, ...props }, ref) => {
  const innerRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(ref, () => innerRef.current as HTMLDivElement);

  return (
    <DrawerPortal container={container}>
      {/* Always rendered, including for stacked drawers: every layer gets
            its own scrim, and Radix mounts `RemoveScroll` here, so a drawer
            without an overlay inherits the layer below's scroll lock and
            cannot be scrolled at all. */}
      <DrawerOverlay className={overlayClassName} />
      <DrawerPrimitive.Content
        ref={innerRef}
        tabIndex={-1}
        className={cn(drawerVariants({ size }), className)}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          if (event.defaultPrevented) return;
          // Focus the panel, never the first focusable child: autofocusing a
          // search input raises the software keyboard over half the screen
          // before the user has asked for it. `preventScroll` keeps the
          // page behind the drawer from jumping.
          event.preventDefault();
          innerRef.current?.focus({ preventScroll: true });
        }}
        {...props}
      >
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
});
DrawerContent.displayName = DrawerPrimitive.Content.displayName;

interface IDrawerHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render the close button. */
  closeable?: boolean;
  /** Accessible name for the close button. Localised by the caller. */
  closeLabel?: string;
  /** Rendered before the title block, e.g. a back button on a nested drawer. */
  leading?: React.ReactNode;
}

const DrawerHeader = React.forwardRef<HTMLDivElement, IDrawerHeaderProps>(
  ({ className, children, closeable = true, closeLabel = 'Close', leading, ...props }, ref) => (
    <div
      ref={ref}
      // `items-start` keeps the close button level with the first line of the
      // title instead of drifting to the vertical centre of a wrapped title.
      className={cn('flex shrink-0 items-start gap-4 border-b px-4 py-3', className)}
      {...props}
    >
      {leading}
      <div className="min-w-0 flex-1">{children}</div>
      {closeable && (
        <DrawerPrimitive.Close
          type="button"
          aria-label={closeLabel}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none"
        >
          <Cross2Icon className="size-4" />
        </DrawerPrimitive.Close>
      )}
    </div>
  )
);
DrawerHeader.displayName = 'DrawerHeader';

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn('truncate text-base font-medium leading-6 text-foreground', className)}
    {...props}
  />
));
DrawerTitle.displayName = DrawerPrimitive.Title.displayName;

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn('mt-1 text-sm font-normal text-muted-foreground', className)}
    {...props}
  />
));
DrawerDescription.displayName = DrawerPrimitive.Description.displayName;

/** The only scrolling region of the drawer; header and footer stay put. */
const DrawerBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      // `relative` is load-bearing: ReadOnlyTip overlays the body with
      // `absolute inset-0`.
      className={cn('relative min-h-0 flex-1 overflow-y-auto overscroll-contain', className)}
      {...props}
    />
  )
);
DrawerBody.displayName = 'DrawerBody';

const DrawerFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('shrink-0 border-t px-4 py-3', className)} {...props} />
  )
);
DrawerFooter.displayName = 'DrawerFooter';

/**
 * Bottom padding that keeps the last row clear of the home indicator.
 * Applied as the drawer's final child rather than as padding on the content,
 * so a sticky footer still sits flush against the safe area.
 */
const DrawerSafeArea = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    aria-hidden
    className={cn('h-[env(safe-area-inset-bottom)] shrink-0 bg-background', className)}
    {...props}
  />
);
DrawerSafeArea.displayName = 'DrawerSafeArea';

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
  DrawerSafeArea,
  drawerVariants,
};
export type { IDrawerContentProps, IDrawerHeaderProps };
