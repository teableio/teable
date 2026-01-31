import type { IAttachmentCellValue, IRecord } from '@teable/core';
import { deleteRecord } from '@teable/openapi';
import { sonner } from '@teable/ui-lib';
import { useEffect, useState, type FC, type PropsWithChildren } from 'react';
import { useLocalStorage } from 'react-use';
import { LocalStorageKeys } from '../../config/local-storage-keys';
import { StandaloneViewProvider, ViewProvider } from '../../context';
import { useTranslation } from '../../context/app/i18n';
import type { IButtonClickStatusHook } from '../../hooks';
import { useBaseId, useRecordOperations, useTableId, useTablePermission } from '../../hooks';
import { syncCopy } from '../../utils';
import { ExpandRecord } from './ExpandRecord';
import type { ExpandRecordModel } from './type';

const { toast } = sonner;
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
  commentId?: string;
  recordIds?: string[];
  model?: ExpandRecordModel;
  serverData?: IRecord;
  onClose?: () => void;
  onUpdateRecordIdCallback?: (recordId: string) => void;
  buttonClickStatusHook?: IButtonClickStatusHook;
  showHistory?: boolean;
  showComment?: boolean;
  onAttachmentDownload?: (attachments: IAttachmentCellValue) => void;
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
    commentId,
    viewId,
    buttonClickStatusHook,
    showHistory,
    showComment,
    onAttachmentDownload,
  } = props;
  const { t } = useTranslation();
  const permission = useTablePermission();
  const { duplicateRecord } = useRecordOperations();
  const editable = Boolean(permission['record|update']);
  const canRead = Boolean(permission['record|read']);
  const canDelete = Boolean(permission['record|delete']);
  const [recordHistoryVisible, setRecordHistoryVisible] = useState<boolean>(Boolean(showHistory));

  const [commentVisible, setCommentVisible] = useLocalStorage<boolean>(
    LocalStorageKeys.CommentVisible,
    !!commentId || Boolean(showComment)
  );

  useEffect(() => {
    if (showHistory !== undefined) {
      setCommentVisible(false);
      setRecordHistoryVisible(showHistory);
    }
  }, [showHistory, setCommentVisible, setRecordHistoryVisible]);

  useEffect(() => {
    if (commentId) {
      setRecordHistoryVisible(false);
      setCommentVisible(true);
      return;
    }
    if (showComment !== undefined) {
      setRecordHistoryVisible(false);
      setCommentVisible(showComment);
    }
  }, [showComment, commentId, setCommentVisible, setRecordHistoryVisible]);

  useEffect(() => {
    if (!recordId) {
      setRecordHistoryVisible(false);
    }
  }, [recordId, setRecordHistoryVisible]);

  if (!recordId) {
    return <></>;
  }

  const onDuplicate = async () => {
    await duplicateRecord({
      tableId,
      recordId,
      order: {
        viewId: viewId || '',
        anchorId: recordId,
        position: 'after',
      },
    });
    toast.success(t('expandRecord.duplicateRecord'));
  };

  const updateCurrentRecordId = (recordId: string) => {
    onUpdateRecordIdCallback?.(recordId);
  };

  const onCopyUrl = () => {
    const url = window.location.href;
    syncCopy(url);
    toast.success(t('expandRecord.copy'));
  };

  const onRecordHistoryToggle = () => {
    setCommentVisible(false);
    setRecordHistoryVisible(!recordHistoryVisible);
  };

  const onCommentToggle = () => {
    setRecordHistoryVisible(false);
    setCommentVisible(!commentVisible);
  };

  return (
    <div id={`${tableId}-${recordId}`}>
      <Wrap tableId={tableId}>
        <ExpandRecord
          visible
          model={model}
          recordId={recordId}
          recordIds={recordIds}
          commentId={commentId}
          serverData={serverData?.id === recordId ? serverData : undefined}
          recordHistoryVisible={editable && recordHistoryVisible}
          commentVisible={canRead && commentVisible}
          onClose={onClose}
          onPrev={updateCurrentRecordId}
          onNext={updateCurrentRecordId}
          onCopyUrl={onCopyUrl}
          onDuplicate={viewId ? onDuplicate : undefined}
          onRecordHistoryToggle={onRecordHistoryToggle}
          onCommentToggle={onCommentToggle}
          onDelete={async () => {
            if (canDelete) await deleteRecord(tableId, recordId);
          }}
          buttonClickStatusHook={buttonClickStatusHook}
          onAttachmentDownload={onAttachmentDownload}
        />
      </Wrap>
    </div>
  );
};
