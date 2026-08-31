import type { IAttachmentCellValue, IRecord } from '@teable/core';
import { deleteRecord } from '@teable/openapi';
import { sonner } from '@teable/ui-lib';
import { useContext, useEffect, useMemo, useState, type FC, type PropsWithChildren } from 'react';
import { useLocalStorage } from 'react-use';
import { LocalStorageKeys } from '../../config/local-storage-keys';
import { ShareViewContext, StandaloneViewProvider, ViewProvider } from '../../context';
import { useTranslation } from '../../context/app/i18n';
import type { IButtonClickStatusHook } from '../../hooks';
import {
  useBaseId,
  useCommentPermission,
  useRecordOperations,
  useTableId,
  useTablePermission,
  useTables,
} from '../../hooks';
import { syncCopy } from '../../utils';
import { ExpandRecord } from './ExpandRecord';
import { useExpandRecordNavigation } from './ExpandRecordNavigationContext';
import type { ExpandRecordModel } from './type';

const { toast } = sonner;

const openLinkedRecordKeys = new Set<string>();

export const isLinkedRecordOpen = (tableId: string, recordId: string) =>
  openLinkedRecordKeys.has(`${tableId}-${recordId}`);
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
  isLinkedRecord?: boolean;
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
    isLinkedRecord,
  } = props;
  const { t } = useTranslation();
  const tables = useTables();
  const baseId = useBaseId();
  const currentTableId = useTableId();
  const { onHighlightTable, navigateToTable } = useExpandRecordNavigation();
  const permission = useTablePermission();
  const { duplicateRecord } = useRecordOperations();
  // Record history is intentionally hidden inside a share view: it would leak
  // collaborator identities and prior values to external link visitors. The
  // record|create gate (duplicate) is handled by ExpandRecordHeader via
  // useTablePermission and doesn't need a context check; the comment gates live
  // in useCommentPermission, which carries the same share-view exclusion.
  const { shareId } = useContext(ShareViewContext);
  const isShareContext = Boolean(shareId);

  const isForeignTable = isLinkedRecord || (Boolean(currentTableId) && tableId !== currentTableId);
  const foreignTableName = useMemo(() => {
    if (!isForeignTable) return undefined;
    return tables.find((table) => table.id === tableId)?.name;
  }, [isForeignTable, tables, tableId]);

  useEffect(() => {
    if (!isLinkedRecord || !recordId) return;
    const key = `${tableId}-${recordId}`;
    openLinkedRecordKeys.add(key);
    return () => {
      openLinkedRecordKeys.delete(key);
    };
  }, [isLinkedRecord, tableId, recordId]);

  useEffect(() => {
    if (isForeignTable && recordId) {
      onHighlightTable?.(tableId);
      window.dispatchEvent(
        new CustomEvent('teable:highlight-table', { detail: { tableId, action: 'push' } })
      );
      return () => {
        window.dispatchEvent(
          new CustomEvent('teable:highlight-table', { detail: { tableId, action: 'pop' } })
        );
      };
    }
  }, [isForeignTable, tableId, recordId, onHighlightTable]);
  const editable = Boolean(permission['record|update']);
  const canDelete = Boolean(permission['record|delete']);
  const { commentReadable } = useCommentPermission();
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
    // A record of another table (a linked record opened from a link cell) can't be
    // addressed by this page's url — copying the address bar would hand out a link to
    // whatever THIS page is showing. Build the record's own url instead, the same shape
    // the card context menu uses; it lands on the foreign table's default view.
    if (isForeignTable) {
      syncCopy(`${window.location.origin}/base/${baseId}/table/${tableId}?recordId=${recordId}`);
      toast.success(t('expandRecord.copy'));
      return;
    }
    const url = new URL(window.location.href);
    // The address bar is the link, but not every view puts the expanded record in it:
    // kanban / gallery / calendar expand through component state, so their url stops at
    // the view and the copied link would not open the record (teableio/teable#3626).
    // Only rewrite when it is actually pointing somewhere else — setting any param
    // re-serializes the whole query (a `%20` comes back as `+`), while an untouched URL
    // round-trips through toString() byte-for-byte.
    if (url.searchParams.get('recordId') !== recordId) {
      url.searchParams.set('recordId', recordId);
    }
    syncCopy(url.toString());
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
          recordHistoryVisible={!isShareContext && editable && recordHistoryVisible}
          commentVisible={commentReadable && commentVisible}
          foreignTableName={foreignTableName}
          onForeignTableClick={
            isForeignTable && tableId !== currentTableId
              ? () => navigateToTable?.(tableId)
              : undefined
          }
          onClose={onClose}
          onPrev={updateCurrentRecordId}
          onNext={updateCurrentRecordId}
          // inside a share view there is no baseId, so no url can address a foreign
          // record — hide the copy button rather than copy a wrong link
          onCopyUrl={isForeignTable && !baseId ? undefined : onCopyUrl}
          onDuplicate={viewId ? onDuplicate : undefined}
          onRecordHistoryToggle={isShareContext ? undefined : onRecordHistoryToggle}
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
