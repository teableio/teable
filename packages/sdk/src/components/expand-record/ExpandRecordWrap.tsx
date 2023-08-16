import { type FC, type PropsWithChildren } from 'react';
import { Modal } from './Modal';
import { Panel } from './Panel';
import { IExpandRecordModel } from './type';

export const ExpandRecordWrap: FC<
  PropsWithChildren<{
    visible?: boolean;
    model?: IExpandRecordModel;
    onClose?: () => void;
  }>
> = (props) => {
  const { children, model, visible, onClose } = props;

  if (model === IExpandRecordModel.Modal)
    return (
      <Modal visible={visible} onClose={onClose}>
        {children}
      </Modal>
    );
  return <Panel visible={visible}>{children}</Panel>;
};
