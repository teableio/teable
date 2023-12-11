import { Dialog, DialogContent } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { type FC, type PropsWithChildren } from 'react';

export const Modal: FC<
  PropsWithChildren<{
    container?: HTMLDivElement;
    visible?: boolean;
    showActivity?: boolean;
    onClose?: () => void;
  }>
> = (props) => {
  const { children, container, visible, showActivity, onClose } = props;

  return (
    <Dialog open={visible} onOpenChange={onClose} modal>
      <DialogContent
        closeable={false}
        container={container}
        className={classNames('h-full block p-0 max-w-3xl', showActivity && 'max-w-5xl')}
        style={{ width: 'calc(100% - 40px)', height: 'calc(100% - 100px)' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
};
