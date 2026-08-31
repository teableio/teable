import {
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerSafeArea,
  DrawerTitle,
  DrawerTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { DrawerStackContext } from './DrawerStackContext';
import { useIsDrawerPanel } from './useIsDrawerLayout';

export interface IAdaptivePanelProps {
  /**
   * Opt in to drawer rendering on narrow viewports. Off by default so panels
   * shared with non-toolbar surfaces keep their popover.
   */
  responsive?: boolean;

  /** The trigger. Rendered exactly once, as the trigger of whichever root wins. */
  children: React.ReactNode;
  /** Panel body. Scrolls in the drawer; laid out inline in the popover. */
  content: React.ReactNode;
  /** Pinned to the bottom of the drawer; rendered after `content` in the popover. */
  footer?: React.ReactNode;
  /**
   * Rendered above `content` and `footer` inside a positioned wrapper - this
   * is where `ReadOnlyTip` goes, so a locked view blocks the panel body while
   * leaving the drawer's close button reachable.
   */
  overlay?: React.ReactNode;

  /** Drawer heading. Not rendered on desktop. */
  title: string;
  description?: string;

  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;

  /** Popover-only positioning. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  container?: HTMLElement | null;
  popoverClassName?: string;
  popoverStyle?: React.CSSProperties;
  /** Popover root `modal`. The drawer is always modal. */
  modal?: boolean;

  /** `list` pins the drawer at 60dvh so a search box cannot resize it. */
  drawerSize?: 'auto' | 'list';
  drawerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;

  /** Show the drawer's close button. */
  closeable?: boolean;
  /**
   * When false, Escape and outside taps are swallowed. Used by the kanban
   * stacking-field picker, which cannot be dismissed until a field is chosen.
   */
  dismissible?: boolean;
  onDismissAttempt?: () => void;
}

/**
 * Renders a toolbar panel as an anchored popover on desktop and a bottom
 * drawer on narrow viewports.
 *
 * Every toolbar panel goes through this component; none of them may test the
 * breakpoint themselves. That is what keeps a panel open, rather than
 * silently closing, when the viewport crosses the breakpoint while it is
 * showing: only the rendered shape changes, the open state lives here.
 */
export const AdaptivePanel = (props: IAdaptivePanelProps) => {
  const {
    responsive,
    children,
    content,
    footer,
    overlay,
    title,
    description,
    open: openProp,
    defaultOpen,
    onOpenChange,
    side = 'bottom',
    align = 'start',
    sideOffset,
    container,
    popoverClassName,
    popoverStyle,
    modal,
    drawerSize,
    drawerClassName,
    bodyClassName,
    footerClassName,
    closeable = true,
    dismissible = true,
    onDismissAttempt,
  } = props;

  const { t } = useTranslation();
  const isDrawer = useIsDrawerPanel(responsive);

  const [innerOpen, setInnerOpen] = useState(Boolean(defaultOpen));
  const open = openProp ?? innerOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      setInnerOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );

  const close = useCallback(() => setOpen(false), [setOpen]);
  const stack = useMemo(() => ({ depth: 1, close }), [close]);

  if (!isDrawer) {
    return (
      <Popover open={open} onOpenChange={setOpen} modal={modal}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          side={side}
          align={align}
          sideOffset={sideOffset}
          container={container}
          className={popoverClassName}
          style={popoverStyle}
        >
          {overlay}
          {content}
          {footer}
        </PopoverContent>
      </Popover>
    );
  }

  const blockDismiss = (event: { preventDefault: () => void }) => {
    if (dismissible) return;
    event.preventDefault();
    onDismissAttempt?.();
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent
        size={drawerSize}
        container={container}
        className={drawerClassName}
        onEscapeKeyDown={blockDismiss}
        onInteractOutside={blockDismiss}
        // Drop the association when there is no description, rather than
        // leaving the dialog pointing at an id that was never rendered and
        // having a screen reader announce a phantom description.
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <DrawerHeader closeable={closeable && dismissible} closeLabel={t('common.close')}>
          <DrawerTitle>{title}</DrawerTitle>
          {description && <DrawerDescription>{description}</DrawerDescription>}
        </DrawerHeader>
        <DrawerStackContext.Provider value={stack}>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {overlay}
            <DrawerBody className={bodyClassName}>{content}</DrawerBody>
            {footer && <DrawerFooter className={cn(footerClassName)}>{footer}</DrawerFooter>}
          </div>
        </DrawerStackContext.Provider>
        <DrawerSafeArea />
      </DrawerContent>
    </Drawer>
  );
};
