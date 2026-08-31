import type { IAttachmentCellValue, IRecord } from '@teable/core';
import { ChevronLeft, ChevronRight } from '@teable/icons';
import { Button, Skeleton, cn } from '@teable/ui-lib';
import { isEqual } from 'lodash';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';
import type { IButtonClickStatusHook } from '../../hooks';
import {
  useFields,
  useIsMobile,
  useRecord,
  useViewId,
  useViews,
  useTableId,
  useBaseId,
  useTablePermission,
} from '../../hooks';
import type { GridView, IFieldInstance } from '../../model';
import { useExpandRecordHiddenFieldsStore } from '../../store';
import { CommentPanel } from '../comment';
import { ExpandRecordHeader } from './ExpandRecordHeader';
import { ExpandRecordWrap } from './ExpandRecordWrap';
import { RecordEditor } from './RecordEditor';
import { RecordHistory } from './RecordHistory';
import { ExpandRecordModel } from './type';

const skeletonRows = [72, 96, 64, 88, 76, 104];

interface IExpandRecordProps {
  recordId: string;
  recordIds?: string[];
  commentId?: string;
  visible?: boolean;
  model?: ExpandRecordModel;
  serverData?: IRecord;
  recordHistoryVisible?: boolean;
  commentVisible?: boolean;
  foreignTableName?: string;
  onForeignTableClick?: () => void;
  onClose?: () => void;
  onPrev?: (recordId: string) => void;
  onNext?: (recordId: string) => void;
  onCopyUrl?: () => void;
  onRecordHistoryToggle?: () => void;
  onCommentToggle?: () => void;
  onDelete?: () => Promise<void>;
  onDuplicate?: () => Promise<void>;
  buttonClickStatusHook?: IButtonClickStatusHook;
  onAttachmentDownload?: (attachments: IAttachmentCellValue) => void;
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
    foreignTableName,
    onForeignTableClick,
    onPrev,
    onNext,
    onClose,
    onCopyUrl,
    onRecordHistoryToggle,
    onCommentToggle,
    onDelete,
    onDuplicate,
    buttonClickStatusHook,
    onAttachmentDownload,
  } = props;
  const views = useViews() as (GridView | undefined)[];
  const tableId = useTableId();
  const defaultViewId = views?.[0]?.id;
  const viewId = useViewId() ?? defaultViewId;
  const baseId = useBaseId();
  const allFields = useFields({ withHidden: true });
  const showFields = useFields();

  const showFieldsId = useMemo(() => new Set(showFields.map((field) => field.id)), [showFields]);

  const fields = useMemo(
    () => (viewId ? allFields.filter((field) => showFieldsId.has(field.id)) : []),
    [allFields, showFieldsId, viewId]
  );

  const hiddenFields = useMemo(
    () => (viewId ? allFields.filter((field) => !showFieldsId.has(field.id)) : []),
    [allFields, showFieldsId, viewId]
  );

  const hiddenFieldsVisible = useExpandRecordHiddenFieldsStore(
    (state) => state.hiddenFieldsVisible
  );
  const record = useRecord(recordId, serverData, {
    withHidden: hiddenFieldsVisible && hiddenFields.length > 0,
  });
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const tablePermission = useTablePermission();
  const canUpdateRecord = tablePermission['record|update'];

  const fieldCellReadonly = useCallback(
    (field: IFieldInstance) => {
      if (!canUpdateRecord) {
        return true;
      }

      return Boolean(record?.isLocked(field.id)) || Boolean(field.isComputed);
    },
    [record, canUpdateRecord]
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
        return record?.updateCell(fieldId, null, { t });
      }
      record?.updateCell(fieldId, newValue, { t });
    },
    [record, t]
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

  // There is no room for the side-by-side layout on mobile, so the comment panel takes over the
  // whole body instead of squeezing the record detail next to the fixed-width comment column.
  const commentPanelFullWidth = Boolean(
    isMobile && commentVisible && baseId && tableId && recordId
  );

  return (
    <ExpandRecordWrap
      model={isMobile ? ExpandRecordModel.Drawer : model ?? ExpandRecordModel.Modal}
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
            foreignTableName={foreignTableName}
            onForeignTableClick={onForeignTableClick}
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
        <div className="relative flex flex-1 overflow-hidden rounded-b-lg">
          {recordHistoryVisible ? (
            <div className="flex size-full overflow-hidden rounded-b bg-background">
              <RecordHistory recordId={recordId} />
            </div>
          ) : (
            <div className="relative flex w-full flex-1 justify-between overflow-y-auto">
              {!commentPanelFullWidth && (
                <div
                  className={cn('size-full overflow-auto', isMobile ? 'px-6 py-6' : 'px-14 py-9')}
                >
                  {record && fields.length > 0 ? (
                    <RecordEditor
                      record={record}
                      fields={fields}
                      hiddenFields={hiddenFields}
                      onChange={onChange}
                      readonly={fieldCellReadonly}
                      buttonClickStatusHook={buttonClickStatusHook}
                      onAttachmentDownload={onAttachmentDownload}
                    />
                  ) : (
                    <div className="mx-auto max-w-3xl" aria-busy="true">
                      <div className="space-y-6">
                        {skeletonRows.map((labelWidth) => (
                          <div
                            key={labelWidth}
                            className={cn(
                              'relative',
                              isMobile ? 'space-y-2' : 'flex space-x-4 rtl:space-x-reverse'
                            )}
                          >
                            <div
                              className={cn(
                                'flex w-36 items-top space-x-1 rtl:space-x-reverse',
                                isMobile ? 'w-full' : 'pt-1'
                              )}
                            >
                              <div className="flex size-5 items-center">
                                <Skeleton className="size-4 rounded-sm" />
                              </div>
                              <div className="flex h-5 min-w-0 items-center text-sm">
                                <Skeleton
                                  className="h-4 rounded-sm"
                                  style={{ width: labelWidth }}
                                />
                              </div>
                            </div>
                            <div className="min-w-0 flex-1 p-0.5">
                              <Skeleton className="h-8 w-full rounded-sm" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {commentVisible && baseId && tableId && recordId && (
                <div
                  className={cn('shrink-0', {
                    'w-full': commentPanelFullWidth,
                    'w-[320px]': !commentPanelFullWidth,
                  })}
                >
                  <CommentPanel
                    tableId={tableId}
                    recordId={recordId}
                    baseId={baseId}
                    commentId={commentId}
                    className={cn({
                      // the drawer sits at bottom-0 under viewport-fit=cover, and the mobile
                      // footer that used to carry this inset is hidden in this state
                      'border-s-0 pb-[env(safe-area-inset-bottom)]': commentPanelFullWidth,
                    })}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        {isMobile && !commentPanelFullWidth && (!disabledPrev || !disabledNext) && (
          <div className="flex shrink-0 items-center gap-4 border-t bg-background px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            <Button
              variant="outline"
              className="min-w-0 flex-1 rounded-md"
              onClick={onPrevInner}
              disabled={disabledPrev}
            >
              <ChevronLeft className="size-4 shrink-0" />
              <span className="truncate">{t('expandRecord.previousRecord')}</span>
            </Button>
            <Button
              variant="outline"
              className="min-w-0 flex-1 rounded-md"
              onClick={onNextInner}
              disabled={disabledNext}
            >
              <span className="truncate">{t('expandRecord.nextRecord')}</span>
              <ChevronRight className="size-4 shrink-0" />
            </Button>
          </div>
        )}
      </div>
    </ExpandRecordWrap>
  );
};
