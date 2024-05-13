import type { IRecord } from '@teable/core';
import { Separator, Skeleton, cn } from '@teable/ui-lib';
import { isEqual } from 'lodash';
import { useCallback, useMemo } from 'react';
import { useMeasure } from 'react-use';
import {
  useFieldCellEditable,
  useFields,
  useIsTouchDevice,
  useRecord,
  useViewId,
  useViews,
} from '../../hooks';
import type { GridView, IFieldInstance } from '../../model';
import { ExpandRecordHeader } from './ExpandRecordHeader';
import { ExpandRecordRight } from './ExpandRecordRight';
import { ExpandRecordWrap } from './ExpandRecordWrap';
import { RecordEditor } from './RecordEditor';
import { ExpandRecordModel } from './type';

// eslint-disable-next-line @typescript-eslint/naming-convention
const MIN_SHOW_ACTIVITY_WIDTH = 700;

interface IExpandRecordProps {
  recordId: string;
  recordIds?: string[];
  visible?: boolean;
  model?: ExpandRecordModel;
  serverData?: IRecord;
  showActivity?: boolean;
  onClose?: () => void;
  onPrev?: (recordId: string) => void;
  onNext?: (recordId: string) => void;
  onCopyUrl?: () => void;
  onShowActivity?: () => void;
}

export const ExpandRecord = (props: IExpandRecordProps) => {
  const {
    model,
    visible,
    recordId,
    recordIds,
    serverData,
    showActivity,
    onPrev,
    onNext,
    onClose,
    onCopyUrl,
    onShowActivity,
  } = props;
  const views = useViews() as (GridView | undefined)[];
  const defaultViewId = views?.[0]?.id;
  const viewId = useViewId() ?? defaultViewId;
  const allFields = useFields({ withHidden: true, withDenied: true });
  const showFields = useFields();
  const record = useRecord(recordId, serverData);
  const [containerRef, { width: containerWidth }] = useMeasure<HTMLDivElement>();
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

  const onChange = (newValue: unknown, fieldId: string) => {
    if (isEqual(record?.getCellValue(fieldId), newValue)) {
      return;
    }
    record?.updateCell(fieldId, newValue);
  };

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
      showActivity={showActivity}
      onClose={onClose}
    >
      <div ref={containerRef} className="flex h-full flex-col overflow-x-auto">
        <ExpandRecordHeader
          title={record?.name}
          showActivity={showActivity}
          disabledPrev={disabledPrev}
          disabledNext={disabledNext}
          onClose={onClose}
          onPrev={onPrevInner}
          onNext={onNextInner}
          onCopyUrl={onCopyUrl}
          onShowActivity={onShowActivity}
        />
        <div className="relative flex flex-1 overflow-y-hidden">
          <div className="min-w-[300px] flex-1 overflow-y-auto px-9 pb-9 pt-6">
            {fields.length > 0 ? (
              <RecordEditor
                record={record}
                fields={fields}
                hiddenFields={hiddenFields}
                onChange={onChange}
                readonly={fieldCellReadonly}
              />
            ) : (
              <Skeleton className="h-10 w-full rounded" />
            )}
          </div>

          {showActivity && (
            <div
              className={cn('flex', {
                'absolute top-0 right-0 h-full bg-background w-80':
                  containerWidth <= MIN_SHOW_ACTIVITY_WIDTH,
              })}
            >
              <Separator className="h-full" orientation="vertical" />
              <ExpandRecordRight />
            </div>
          )}
        </div>
      </div>
    </ExpandRecordWrap>
  );
};
