import {
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerSafeArea,
  DrawerTitle,
  DrawerTrigger,
} from '@teable/ui-lib';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { DrawerStackContext, useDrawerStack } from './DrawerStackContext';

export interface INestedDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Trigger element. Rendered in place, wherever the parent drawer put it. */
  children: React.ReactNode;
  content: React.ReactNode;
  footer?: React.ReactNode;
  /** `list` pins the panel at 60dvh so a search filter cannot resize it. */
  size?: 'auto' | 'list';
  className?: string;
  bodyClassName?: string;
}

/**
 * A drawer stacked on top of another drawer.
 *
 * The single implementation for every second-level selector - field pickers,
 * operator pickers, conjunctions, date modes, sort order. Escape, an outside
 * tap and the close button all dismiss only this layer and return the user to
 * the parent drawer, which stays open and keeps its state.
 */
export const NestedDrawer = (props: INestedDrawerProps) => {
  const { open, onOpenChange, title, children, content, footer, size, className, bodyClassName } =
    props;
  const { t } = useTranslation();
  const { depth } = useDrawerStack();

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const stack = useMemo(() => ({ depth: depth + 1, close }), [depth, close]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent
        size={size}
        // Every stacked layer carries its own scrim, so the parent drawer
        // visibly recedes behind the selector sitting on top of it. The
        // overlay is also where Radix mounts `RemoveScroll`; without one, the
        // parent's scroll lock stays topmost and cancels every wheel and
        // touchmove inside this panel.
        className={className}
        // Nothing here has a description; say so explicitly rather than
        // letting the dialog point at an id that was never rendered.
        aria-describedby={undefined}
      >
        <DrawerHeader closeLabel={t('common.close')}>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <DrawerStackContext.Provider value={stack}>
          <DrawerBody className={bodyClassName}>{content}</DrawerBody>
          {footer && <DrawerFooter className={cn('px-4 py-3')}>{footer}</DrawerFooter>}
        </DrawerStackContext.Provider>
        <DrawerSafeArea />
      </DrawerContent>
    </Drawer>
  );
};
