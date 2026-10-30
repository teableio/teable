import type { IAttachmentCellValue, IRecord } from '@teable/core';
import { ChevronLeft, ChevronRight } from '@teable/icons';
import { Button, Skeleton, cn } from '@teable/ui-lib';
import { isEqual } from 'lodash';
import { useCallback, useContext, useMemo } from 'react';
import { useMeasure } from 'react-use';
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
import { useContentDir } from '../../hooks/use-content-dir';
import type { GridView, IFieldInstance } from '../../model';
import { useExpandRecordHiddenFieldsStore } from '../../store';
import { CommentPanel } from '../comment';
import { ExpandRecordBreadcrumb } from './ExpandRecordBreadcrumb';
import { ExpandRecordHeader } from './ExpandRecordHeader';
import { ExpandRecordWrap } from './ExpandRecordWrap';
import { ExpandRecordPanelHostContext, ExpandRecordPanelStackContext } from './PanelContext';
import { RecordEditor } from './RecordEditor';
import { RecordHistory } from './RecordHistory';
import { ExpandRecordModel } from './type';

const skeletonRows = [72, 96, 64, 88, 76, 104];

// eslint-disable-next-line @typescript-eslint/naming-convention
const COMMENT_PANEL_WIDTH = 320;
// beside the comment column the fields need at least this much, or only the comments show
// eslint-disable-next-line @typescript-eslint/naming-convention
const FIELDS_MIN_WIDTH = 320;
// a panel at least this wide gets the roomier padding
// eslint-disable-next-line @typescript-eslint/naming-convention
const PANEL_WIDE_MIN = 640;

// inside a table node a record opens as a side panel; an explicit model wins, a phone gets the sheet
const resolveModel = (isMobile: boolean, inHost: boolean, model?: ExpandRecordModel) => {
  if (isMobile) return ExpandRecordModel.Drawer;
  return model ?? (inHost ? ExpandRecordModel.Panel : ExpandRecordModel.Modal);
};

// a linked record opened from a panel covers it: its breadcrumb goes back, ✕ closes them all
const getPanelCloseActions = (
  isPanel: boolean,
  parentStack: { depth: number; closeRoot?: () => void },
  onClose?: () => void
) => {
  if (!isPanel || parentStack.depth === 0) return { onCloseAll: onClose, isStacked: false };
  return { onCloseAll: parentStack.closeRoot ?? onClose, isStacked: true };
};

// No room for the side-by-side layout (a phone, or a panel too narrow for the fields beside the
// comment column): the comment panel takes over the whole body instead of squeezing the fields.
const isCommentFullWidth = (isMobile: boolean, isPanel: boolean, bodyWidth: number) => {
  if (isMobile) return true;
  return isPanel && bodyWidth > 0 && bodyWidth - COMMENT_PANEL_WIDTH < FIELDS_MIN_WIDTH;
};

const getBodyPadding = (isMobile: boolean, isPanel: boolean, bodyWidth: number) => {
  if (isMobile) return { x: 'px-6', bottom: 'pb-6' };
  if (!isPanel) return { x: 'px-14', bottom: 'pb-9' };
  return bodyWidth >= PANEL_WIDE_MIN
    ? { x: 'px-12', bottom: 'pb-8' }
    : { x: 'px-6', bottom: 'pb-6' };
};

interface IExpandRecordProps {
  recordId: string;
  recordIds?: string[];
  commentId?: string;
  visible?: boolean;
  model?: ExpandRecordModel;
  serverData?: IRecord;
  recordHistoryVisible?: boolean;
  commentVisible?: boolean;
  // the record's table, and for a record of another table than the page's, its name again
  tableName?: string;
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
  onAddToChat?: () => void;
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
    tableName,
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
    onAddToChat,
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
    hydrate: true,
    withHidden: hiddenFieldsVisible && hiddenFields.length > 0,
  });
  const isMobile = useIsMobile();
  const { inHost } = useContext(ExpandRecordPanelHostContext);
  const parentStack = useContext(ExpandRecordPanelStackContext);
  const [bodyRef, { width: bodyWidth }] = useMeasure<HTMLDivElement>();
  const { t } = useTranslation();
  const contentDir = useContentDir();
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
    return recordIds?.length ? recordIds.indexOf(recordId) + 1 : -1;
  }, [recordId, recordIds]);

  const prevRecordIndex = useMemo(() => {
    return recordIds?.length ? recordIds.indexOf(recordId) - 1 : -1;
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

  const resolvedModel = resolveModel(isMobile, inHost, model);
  const isPanel = resolvedModel === ExpandRecordModel.Panel;
  const commentPanelFullWidth = Boolean(
    commentVisible &&
    baseId &&
    tableId &&
    recordId &&
    isCommentFullWidth(isMobile, isPanel, bodyWidth)
  );
  const { onCloseAll, isStacked } = getPanelCloseActions(isPanel, parentStack, onClose);
  const bodyPadding = getBodyPadding(isMobile, isPanel, bodyWidth);

  const crumb = { title: record?.title, tableName, openTable: onForeignTableClick };
  // fixed above whatever scrolls below it: the fields, or the comments or history taking over
  const titleBlock = tableId && (
    <div className={cn('shrink-0 pb-4 pt-5', bodyPadding.x)}>
      <h2
        dir={contentDir}
        title={record?.title}
        // where the link line from the sidebar's table ends, for a record of another table
        data-link-highlight-target={foreignTableName ? tableId : undefined}
        className="mx-auto max-w-3xl truncate text-xl font-semibold tracking-tight"
      >
        {record?.title || t('common.untitled')}
      </h2>
    </div>
  );

  return (
    <ExpandRecordWrap
      model={resolvedModel}
      visible={visible}
      onClose={onClose}
      className={cn({ 'max-w-5xl': commentVisible })}
      panelExtraWidth={commentVisible ? COMMENT_PANEL_WIDTH : 0}
      panelCrumb={crumb}
    >
      <div ref={bodyRef} className="flex h-full flex-col">
        {tableId && recordId && (
          <ExpandRecordHeader
            breadcrumb={
              isStacked ? (
                <ExpandRecordBreadcrumb
                  crumbs={[...parentStack.trail, { ...crumb, close: onClose }]}
                />
              ) : undefined
            }
            recordHistoryVisible={recordHistoryVisible}
            commentVisible={commentVisible}
            disabledPrev={disabledPrev}
            disabledNext={disabledNext}
            onClose={onCloseAll}
            onPrev={onPrevInner}
            onNext={onNextInner}
            onCopyUrl={onCopyUrl}
            onRecordHistoryToggle={onRecordHistoryToggle}
            onCommentToggle={onCommentToggle}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onAddToChat={onAddToChat}
            recordId={recordId}
            tableId={tableId}
          />
        )}
        <div className="relative flex flex-1 overflow-hidden rounded-b-lg">
          {recordHistoryVisible ? (
            <div className="flex size-full flex-col overflow-hidden rounded-b bg-background">
              {titleBlock}
              <div className="flex min-h-0 flex-1">
                <RecordHistory recordId={recordId} />
              </div>
            </div>
          ) : (
            <div className="relative flex w-full flex-1 justify-between overflow-hidden">
              {!commentPanelFullWidth && (
                <div className="flex min-w-0 flex-1 flex-col">
                  {titleBlock}
                  <div
                    className={cn(
                      'min-h-0 flex-1 overflow-auto',
                      bodyPadding.x,
                      bodyPadding.bottom
                    )}
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
                </div>
              )}

              {commentVisible && baseId && tableId && recordId && (
                <div
                  className={cn('flex shrink-0 flex-col', {
                    'w-full': commentPanelFullWidth,
                    'w-[320px]': !commentPanelFullWidth,
                  })}
                >
                  {commentPanelFullWidth && titleBlock}
                  <div className="min-h-0 flex-1">
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
