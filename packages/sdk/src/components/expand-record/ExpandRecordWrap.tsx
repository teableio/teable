import { type FC, type PropsWithChildren } from 'react';
import { Modal } from './Modal';
import { Panel } from './Panel';
import { IExpandRecordModel } from './type';

export const ExpandRecordWrap: FC<
  PropsWithChildren<{
    model?: IExpandRecordModel;
    visible?: boolean;
    showActivity?: boolean;
    onClose?: () => void;
  }>
> = (props) => {
  const { children, model, visible, showActivity, onClose } = props;

  if (model === IExpandRecordModel.Modal)
    return (
      <Modal visible={visible} showActivity={showActivity} onClose={onClose}>
        {children}
      </Modal>
    );
  return <Panel visible={visible}>{children}</Panel>;
};
