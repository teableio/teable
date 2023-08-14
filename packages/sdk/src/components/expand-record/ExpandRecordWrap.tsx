import { type FC, type PropsWithChildren } from 'react';
import { IExpandRecordModel } from './context';
import { Modal } from './Modal';
import { Panel } from './Panel';

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
