import { Sheet, SheetContent } from '@teable/ui-lib';
import { type FC, type PropsWithChildren } from 'react';
import { Modal } from './Modal';
import { ExpandRecordModel } from './type';

export const ExpandRecordWrap: FC<
  PropsWithChildren<{
    model?: ExpandRecordModel;
    visible?: boolean;
    onClose?: () => void;
  }>
> = (props) => {
  const { children, model, visible, onClose } = props;

  if (model === ExpandRecordModel.Modal)
    return (
      <Modal visible={visible} onClose={onClose}>
        {children}
      </Modal>
    );

  return (
    <Sheet modal={true} open={visible} onOpenChange={onClose}>
      <SheetContent
        className="h-5/6 overflow-hidden rounded-t-lg p-0"
        side="bottom"
        closeable={false}
      >
        {children}
      </SheetContent>
    </Sheet>
  );
};
