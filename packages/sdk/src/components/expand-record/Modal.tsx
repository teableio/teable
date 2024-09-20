import { Dialog, DialogContent, cn } from '@teable/ui-lib';
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
        className={cn('h-full block p-0 max-w-4xl', className)}
        style={{ width: 'calc(100% - 40px)', height: 'calc(100% - 100px)' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose?.();
          }
          if (e.key === 'Enter') {
            return;
          }
          e.stopPropagation();
        }}
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
