import { Dialog, DialogContent, cn } from '@teable/ui-lib';
import { type FC, type PropsWithChildren } from 'react';

export const Modal: FC<
  PropsWithChildren<{
    modal?: boolean;
    className?: string;
    container?: HTMLDivElement;
    visible?: boolean;
    showActivity?: boolean;
    onClose?: () => void;
  }>
> = (props) => {
  const { modal, className, children, container, visible, showActivity, onClose } = props;

  return (
    <Dialog open={visible} onOpenChange={onClose} modal={modal}>
      <DialogContent
        closeable={false}
        container={container}
        className={cn('h-full block p-0 max-w-3xl', showActivity && 'max-w-5xl', className)}
        style={{ width: 'calc(100% - 40px)', height: 'calc(100% - 100px)' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
};
