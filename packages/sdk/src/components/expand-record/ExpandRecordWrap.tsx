import { Sheet, SheetContent } from '@teable/ui-lib';
import { type FC, type PropsWithChildren, useRef } from 'react';
import { Modal } from './Modal';
import { ModalContext } from './ModalContext';
import { Panel } from './Panel';
import type { IExpandRecordCrumb } from './PanelContext';
import { ExpandRecordPanelHostContext, OUTSIDE_PANEL_HOST } from './PanelContext';
import { ExpandRecordModel } from './type';

export const ExpandRecordWrap: FC<
  PropsWithChildren<{
    model?: ExpandRecordModel;
    modal?: boolean;
    visible?: boolean;
    onClose?: () => void;
    className?: string;
    panelExtraWidth?: number;
    panelCrumb?: Omit<IExpandRecordCrumb, 'close'>;
    // the panel comes back on top whenever this changes, see Panel's raiseKey
    panelRaiseKey?: string;
  }>
> = (props) => {
  const {
    children,
    model,
    visible,
    onClose,
    modal,
    className,
    panelExtraWidth,
    panelCrumb,
    panelRaiseKey,
  } = props;
  const sheetRef = useRef<HTMLDivElement>(null);

  if (model === ExpandRecordModel.Panel)
    return (
      <Panel
        visible={visible}
        onClose={onClose}
        extraWidth={panelExtraWidth}
        crumb={panelCrumb}
        raiseKey={panelRaiseKey}
      >
        {children}
      </Panel>
    );

  if (model === ExpandRecordModel.Modal)
    return (
      <Modal visible={visible} onClose={onClose} modal={modal} className={className}>
        <ExpandRecordPanelHostContext.Provider value={OUTSIDE_PANEL_HOST}>
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
        // The overlay stops below the banners above the app, so a tap on one reaches it
        // instead of closing the record.
        overlayStyle={{ top: 'var(--teable-top-banner-height, 0px)' }}
        ref={sheetRef}
      >
        <ModalContext.Provider value={{ ref: sheetRef }}>
          <ExpandRecordPanelHostContext.Provider value={OUTSIDE_PANEL_HOST}>
            {children}
          </ExpandRecordPanelHostContext.Provider>
        </ModalContext.Provider>
      </SheetContent>
    </Sheet>
  );
};
