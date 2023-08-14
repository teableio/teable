import { Dialog, DialogContent } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useContext, type FC, type PropsWithChildren } from 'react';
import { ExpandRecordContext } from './context';

export const Modal: FC<
  PropsWithChildren<{
    container?: HTMLDivElement;
    visible?: boolean;
    onClose?: () => void;
  }>
> = (props) => {
  const { hideActivity } = useContext(ExpandRecordContext);
  const { children, container, visible, onClose } = props;

  return (
    <Dialog open={visible} onOpenChange={onClose}>
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
