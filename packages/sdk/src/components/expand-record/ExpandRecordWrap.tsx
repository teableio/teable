import { type FC, type PropsWithChildren } from 'react';
import { Modal } from './Modal';
import { Panel } from './Panel';
import { ExpandRecordModel } from './type';

export const ExpandRecordWrap: FC<
  PropsWithChildren<{
    model?: ExpandRecordModel;
    visible?: boolean;
    recordHistoryVisible?: boolean;
    onClose?: () => void;
  }>
> = (props) => {
  const { children, model, visible, recordHistoryVisible, onClose } = props;

  if (model === ExpandRecordModel.Modal)
    return (
      <Modal visible={visible} recordHistoryVisible={recordHistoryVisible} onClose={onClose}>
        {children}
      </Modal>
    );
  return <Panel visible={visible}>{children}</Panel>;
};
