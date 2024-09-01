import type { IRecord } from '@teable/core';
import { deleteRecord, duplicateRecords } from '@teable/openapi';
import { useToast } from '@teable/ui-lib';
import type { FC, PropsWithChildren } from 'react';
import { useLocalStorage } from 'react-use';
import { LocalStorageKeys } from '../../config/local-storage-keys';
import { StandaloneViewProvider, ViewProvider } from '../../context';
import { useTranslation } from '../../context/app/i18n';
import { useBaseId, useTableId, useTablePermission } from '../../hooks';
import { ExpandRecord } from './ExpandRecord';
import type { ExpandRecordModel } from './type';

const Wrap: FC<PropsWithChildren<{ tableId: string }>> = (props) => {
  const { tableId, children } = props;
  const currentTableId = useTableId();
  const baseId = useBaseId();

  if (tableId !== currentTableId) {
    return (
      <StandaloneViewProvider baseId={baseId} tableId={tableId}>
        <ViewProvider>{children}</ViewProvider>
      </StandaloneViewProvider>
    );
  }
  return <>{children}</>;
};

interface IExpandRecorderProps {
  tableId: string;
  viewId?: string;
  recordId?: string;
  recordIds?: string[];
  model?: ExpandRecordModel;
  serverData?: IRecord;
  onClose?: () => void;
  onUpdateRecordIdCallback?: (recordId: string) => void;
}

export const ExpandRecorder = (props: IExpandRecorderProps) => {
  const {
    model,
    tableId,
    recordId,
    recordIds,
    serverData,
    onClose,
    onUpdateRecordIdCallback,
    viewId,
  } = props;
  const { toast } = useToast();
  const { t } = useTranslation();
  const permission = useTablePermission();
  const editable = Boolean(permission['record|update']);
  const canDelete = Boolean(permission['record|delete']);
  const [recordHistoryVisible, setRecordHistoryVisible] = useLocalStorage<boolean>(
    LocalStorageKeys.RecordHistoryVisible,
    false
  );

  if (!recordId) {
    return <></>;
  }

  const updateCurrentRecordId = (recordId: string) => {
    onUpdateRecordIdCallback?.(recordId);
  };

  const onCopyUrl = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    toast({ description: t('expandRecord.copy') });
  };

  const onDuplicate = async (tableId: string, recordId: string) => {
    await duplicateRecords(tableId, recordId, {
      viewId: viewId || '',
      anchorId: recordId,
      position: 'after',
    });
    toast({ description: t('expandRecord.duplicateRecord') });
  };

  const onRecordHistoryToggle = () => {
    setRecordHistoryVisible(!recordHistoryVisible);
  };

  return (
    <div id={`${tableId}-${recordId}`}>
      <Wrap tableId={tableId}>
        <ExpandRecord
          visible
          model={model}
          recordId={recordId}
          recordIds={recordIds}
          serverData={serverData?.id === recordId ? serverData : undefined}
          recordHistoryVisible={editable && recordHistoryVisible}
          onClose={onClose}
          onPrev={updateCurrentRecordId}
          onNext={updateCurrentRecordId}
          onCopyUrl={onCopyUrl}
          onDuplicate={async () => await onDuplicate(tableId, recordId)}
          onRecordHistoryToggle={onRecordHistoryToggle}
          onDelete={async () => {
            if (canDelete) await deleteRecord(tableId, recordId);
          }}
        />
      </Wrap>
    </div>
  );
};
