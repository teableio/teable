import type { IRecord } from '@teable/core';
import { Skeleton, cn } from '@teable/ui-lib';
import { isEqual } from 'lodash';
import { useCallback, useMemo } from 'react';
import {
  useFieldCellEditable,
  useFields,
  useIsTouchDevice,
  useRecord,
  useViewId,
  useViews,
  useTableId,
  useBaseId,
} from '../../hooks';
import type { GridView, IFieldInstance } from '../../model';
import { CommentPanel } from '../comment';
import { ExpandRecordHeader } from './ExpandRecordHeader';
import { ExpandRecordWrap } from './ExpandRecordWrap';
import { RecordEditor } from './RecordEditor';
import { RecordHistory } from './RecordHistory';
import { ExpandRecordModel } from './type';

interface IExpandRecordProps {
  recordId: string;
  recordIds?: string[];
  commentId?: string;
  visible?: boolean;
  model?: ExpandRecordModel;
  serverData?: IRecord;
  recordHistoryVisible?: boolean;
  commentVisible?: boolean;
  onClose?: () => void;
  onPrev?: (recordId: string) => void;
  onNext?: (recordId: string) => void;
  onCopyUrl?: () => void;
  onRecordHistoryToggle?: () => void;
  onCommentToggle?: () => void;
  onDelete?: () => Promise<void>;
  onDuplicate?: () => Promise<void>;
}

export const ExpandRecord = (props: IExpandRecordProps) => {
  const {
    model,
    visible,
    recordId,
    commentId,
    recordIds,
    serverData,
    recordHistoryVisible,
    commentVisible,
    onPrev,
    onNext,
    onClose,
    onCopyUrl,
    onRecordHistoryToggle,
    onCommentToggle,
    onDelete,
    onDuplicate,
  } = props;
  const views = useViews() as (GridView | undefined)[];
  const tableId = useTableId();
  const defaultViewId = views?.[0]?.id;
  const viewId = useViewId() ?? defaultViewId;
  const baseId = useBaseId();
  const allFields = useFields({ withHidden: true, withDenied: true });
  const showFields = useFields();
  const record = useRecord(recordId, serverData);
  const isTouchDevice = useIsTouchDevice();
  const fieldCellEditable = useFieldCellEditable();

  const fieldCellReadonly = useCallback(
    (field: IFieldInstance) => {
      return !fieldCellEditable(field);
    },
    [fieldCellEditable]
  );

  const showFieldsId = useMemo(() => new Set(showFields.map((field) => field.id)), [showFields]);

  const fields = useMemo(
    () => (viewId ? allFields.filter((field) => showFieldsId.has(field.id)) : []),
    [allFields, showFieldsId, viewId]
  );

  const hiddenFields = useMemo(
    () => (viewId ? allFields.filter((field) => !showFieldsId.has(field.id)) : []),
    [allFields, showFieldsId, viewId]
  );

  const nextRecordIndex = useMemo(() => {
    return recordIds?.length ? recordIds.findIndex((id) => recordId === id) + 1 : -1;
  }, [recordId, recordIds]);

  const prevRecordIndex = useMemo(() => {
    return recordIds?.length ? recordIds.findIndex((id) => recordId === id) - 1 : -1;
  }, [recordId, recordIds]);

  const onChange = useCallback(
    (newValue: unknown, fieldId: string) => {
      if (isEqual(record?.getCellValue(fieldId), newValue)) {
        return;
      }
      if (Array.isArray(newValue) && newValue.length === 0) {
        return record?.updateCell(fieldId, null);
      }
      record?.updateCell(fieldId, newValue);
    },
    [record]
  );

  const onPrevInner = () => {
    if (!recordIds?.length || prevRecordIndex === -1) {
      return;
    }
    onPrev?.(recordIds[prevRecordIndex]);
  };

  const onNextInner = () => {
    if (!recordIds?.length || nextRecordIndex === -1) {
      return;
    }
    onNext?.(recordIds[nextRecordIndex]);
  };

  const disabledPrev = prevRecordIndex < 0;
  const disabledNext = !recordIds?.length || nextRecordIndex >= recordIds.length;

  return (
    <ExpandRecordWrap
      model={isTouchDevice ? ExpandRecordModel.Drawer : model ?? ExpandRecordModel.Modal}
      visible={visible}
      onClose={onClose}
      className={cn({ 'max-w-5xl': commentVisible })}
    >
      <div className="flex h-full flex-col">
        {tableId && recordId && (
          <ExpandRecordHeader
            title={record?.title}
            recordHistoryVisible={recordHistoryVisible}
            commentVisible={commentVisible}
            disabledPrev={disabledPrev}
            disabledNext={disabledNext}
            onClose={onClose}
            onPrev={onPrevInner}
            onNext={onNextInner}
            onCopyUrl={onCopyUrl}
            onRecordHistoryToggle={onRecordHistoryToggle}
            onCommentToggle={onCommentToggle}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            recordId={recordId}
            tableId={tableId}
          />
        )}
        <div className="relative flex flex-1 overflow-hidden">
          {recordHistoryVisible ? (
            <div className="flex size-full overflow-hidden rounded-b bg-background">
              <RecordHistory recordId={recordId} />
            </div>
          ) : (
            <div className="relative flex w-full flex-1 justify-between overflow-y-auto">
              {fields.length > 0 ? (
                <div className="size-full overflow-auto p-9">
                  <RecordEditor
                    record={record}
                    fields={fields}
                    hiddenFields={hiddenFields}
                    onChange={onChange}
                    readonly={fieldCellReadonly}
                  />
                </div>
              ) : (
                <Skeleton className="h-10 w-full rounded" />
              )}

              {commentVisible && baseId && tableId && recordId && (
                <div className="w-80 shrink-0">
                  <CommentPanel
                    tableId={tableId}
                    recordId={recordId}
                    baseId={baseId}
                    commentId={commentId}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ExpandRecordWrap>
  );
};
