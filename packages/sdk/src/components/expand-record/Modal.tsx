import { Dialog, DialogContent } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { type FC, type PropsWithChildren } from 'react';
import { useExpandRecord } from './store';

export const Modal: FC<
  PropsWithChildren<{
    container?: HTMLDivElement;
    visible?: boolean;
    onClose?: () => void;
  }>
> = (props) => {
  const { hideActivity } = useExpandRecord();
  const { children, container, visible, onClose } = props;

  return (
    <Dialog open={visible} onOpenChange={onClose} modal>
      <DialogContent
        closeable={false}
        container={container}
        className={classNames('h-full block p-0 max-w-5xl', hideActivity && 'max-w-3xl')}
        style={{ width: 'calc(100% - 40px)', height: 'calc(100% - 100px)' }}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
};
