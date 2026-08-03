import { Dialog, DialogContent, DialogOverlay, cn } from '@teable/ui-lib';
import { type FC, type PropsWithChildren } from 'react';
import { useRef } from 'react';
import { ModalContext } from './ModalContext';

export const Modal: FC<
  PropsWithChildren<{
    modal?: boolean;
    className?: string;
    container?: HTMLDivElement;
    visible?: boolean;
    onClose?: () => void;
  }>
> = (props) => {
  const { modal, className, children, container, visible, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);

  return (
    <Dialog open={visible} modal={modal}>
      <DialogContent
        closeable={false}
        container={container}
        className={cn('h-full block rounded-lg p-0 max-w-4xl', className)}
        style={{ width: 'calc(100% - 40px)', height: 'calc(100% - 100px)' }}
        overlay={
          <DialogOverlay
            onClick={(e) => {
              // When a nested modal layer (e.g. a SingleSelect Popover with
              // modal=true) is open, Radix sets DialogContent's pointer-events
              // to 'none'. Visual clicks inside DialogContent then hit-test
              // through to this overlay and would falsely trigger onClose.
              // DialogContent is fixed-positioned, so checking whether the
              // pointer coordinates fall inside its bounding rect cleanly
              // separates real overlay clicks from click-through events,
              // without depending on any internal layer state.
              const rect = ref.current?.getBoundingClientRect();
              if (
                rect &&
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom
              ) {
                return;
              }
              onClose?.();
            }}
          />
        }
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose?.();
          }
          e.stopPropagation();
        }}
        onPaste={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        ref={ref}
      >
        <ModalContext.Provider value={{ ref }}>{children}</ModalContext.Provider>
      </DialogContent>
    </Dialog>
  );
};
