import { Sheet, SheetContent } from '@teable/ui-lib';
import { type FC, type PropsWithChildren, useRef } from 'react';
import { Modal } from './Modal';
import { ModalContext } from './ModalContext';
import { Panel } from './Panel';
import type { IExpandRecordCrumb } from './PanelContext';
import { ExpandRecordPanelHostContext } from './PanelContext';
import { ExpandRecordModel } from './type';

// Records opened from inside a dialog or sheet stay dialogs: a side panel would land behind it.
const outsideHost = { inHost: false, container: null };

export const ExpandRecordWrap: FC<
  PropsWithChildren<{
    model?: ExpandRecordModel;
    modal?: boolean;
    visible?: boolean;
    onClose?: () => void;
    className?: string;
    panelExtraWidth?: number;
    panelCrumb?: Omit<IExpandRecordCrumb, 'close'>;
  }>
> = (props) => {
  const { children, model, visible, onClose, modal, className, panelExtraWidth, panelCrumb } =
    props;
  const sheetRef = useRef<HTMLDivElement>(null);

  if (model === ExpandRecordModel.Panel)
    return (
      <Panel visible={visible} onClose={onClose} extraWidth={panelExtraWidth} crumb={panelCrumb}>
        {children}
      </Panel>
    );

  if (model === ExpandRecordModel.Modal)
    return (
      <Modal visible={visible} onClose={onClose} modal={modal} className={className}>
        <ExpandRecordPanelHostContext.Provider value={outsideHost}>
          {children}
        </ExpandRecordPanelHostContext.Provider>
      </Modal>
    );

  return (
    <Sheet modal={true} open={visible} onOpenChange={onClose}>
      <SheetContent
        className="h-[92dvh] overflow-hidden rounded-t-lg p-0"
        side="bottom"
        closeable={false}
        ref={sheetRef}
      >
        <ModalContext.Provider value={{ ref: sheetRef }}>
          <ExpandRecordPanelHostContext.Provider value={outsideHost}>
            {children}
          </ExpandRecordPanelHostContext.Provider>
        </ModalContext.Provider>
      </SheetContent>
    </Sheet>
  );
};
