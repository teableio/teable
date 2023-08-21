import type { FC, PropsWithChildren } from 'react';
import { AnchorProvider, ViewProvider } from '../../context';
import { useTableId } from '../../hooks';
import { ExpandRecord } from './ExpandRecord';
import { useExpandRecord } from './store';
import { IExpandRecordModel } from './type';

const Wrap: FC<PropsWithChildren<{ tableId: string }>> = (props) => {
  const { tableId, children } = props;
  const currentTableId = useTableId();

  if (tableId !== currentTableId) {
    return (
      <AnchorProvider tableId={tableId}>
        <ViewProvider>{children}</ViewProvider>
      </AnchorProvider>
    );
  }
  return <>{children}</>;
};

export const ExpandRecorder = () => {
  const { records, removeExpandRecord } = useExpandRecord();

  const onCloseInner = (recordId: string, tableId?: string, onClose?: () => void) => {
    onClose?.();
    removeExpandRecord(tableId, recordId);
  };

  return (
    <div>
      {records.map(({ recordId, tableId, serverData, onClose }) => (
        <Wrap key={`${tableId}-${recordId}`} tableId={tableId}>
          <ExpandRecord
            visible
            recordId={recordId}
            serverData={serverData}
            forceModel={IExpandRecordModel.Modal}
            onClose={() => onCloseInner(recordId, tableId, onClose)}
          />
        </Wrap>
      ))}
    </div>
  );
};
