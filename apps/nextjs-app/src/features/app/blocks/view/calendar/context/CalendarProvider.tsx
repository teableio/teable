import { ColorConfigType, FieldType } from '@teable/core';
import { ExpandRecorder } from '@teable/sdk/components';
import { ShareViewContext } from '@teable/sdk/context';
import {
  useTableId,
  useView,
  useFields,
  useTablePermission,
  usePersonalView,
  useButtonClickStatus,
} from '@teable/sdk/hooks';
import type { CalendarView } from '@teable/sdk/model';
import { useContext, useMemo, useState, type ReactNode } from 'react';
import {
  getExpandRecordIds,
  useRouteExpandRecord,
} from '@/features/app/components/expand-record-container/useRouteExpandRecord';
import { useCalendarFields } from '../hooks';
import { CalendarContext } from './CalendarContext';

export const CalendarProvider = ({ children }: { children: ReactNode }) => {
  const tableId = useTableId();
  const view = useView() as CalendarView | undefined;
  const { personalViewCommonQuery } = usePersonalView();
  const { shareId } = useContext(ShareViewContext) ?? {};
  const { sort, filter } = view ?? {};
  const permission = useTablePermission();
  const allFields = useFields({ withHidden: true, withDenied: true });
  const buttonClickStatusHook = useButtonClickStatus(tableId!, shareId);
  const { expandRecordId, setExpandRecordId, closeExpandRecord, showHistory, showComment } =
    useRouteExpandRecord(tableId);
  const [orderedRecordIds, setOrderedRecordIds] = useState<string[]>();

  const { startDateField, endDateField, titleField, colorConfig } = useCalendarFields();

  const recordQuery = useMemo(() => {
    const { ignoreViewQuery } = personalViewCommonQuery ?? {};
    const baseQuery = {
      orderBy: sort?.sortObjs,
      filter: filter,
    };

    if (shareId) return baseQuery;

    if (ignoreViewQuery) {
      return {
        ...baseQuery,
        ignoreViewQuery,
      };
    }
  }, [shareId, sort, filter, personalViewCommonQuery]);

  const calendarPermission = useMemo(() => {
    const startDateEditable = Boolean(startDateField && !startDateField.isComputed);
    const endDateEditable = Boolean(endDateField && !endDateField.isComputed);
    const isSameField = startDateField?.id === endDateField?.id;

    return {
      eventCreatable: Boolean(permission['record|create']) && startDateEditable && endDateEditable,
      eventResizable:
        Boolean(permission['record|update']) &&
        (startDateEditable || endDateEditable) &&
        !isSameField,
      eventDeletable: Boolean(permission['record|delete']),
      eventDraggable: Boolean(permission['record|update']) && startDateEditable && endDateEditable,
    };
  }, [permission, startDateField, endDateField]);

  const colorField = useMemo(() => {
    const { type: colorType, fieldId: colorFieldId } = colorConfig ?? {};

    if (colorType === ColorConfigType.Field) {
      const field = allFields.find((f) => f.id === colorFieldId);
      if (!field || field.type !== FieldType.SingleSelect || field.isMultipleCellValue) {
        return;
      }

      return field;
    }
  }, [colorConfig, allFields]);

  const value = useMemo(() => {
    return {
      recordQuery,
      startDateField,
      endDateField,
      titleField,
      colorField,
      colorConfig,
      permission: calendarPermission,
      setExpandRecordId,
      setOrderedRecordIds,
    };
  }, [
    recordQuery,
    startDateField,
    endDateField,
    titleField,
    colorField,
    colorConfig,
    calendarPermission,
    setExpandRecordId,
  ]);

  return (
    <CalendarContext.Provider value={value}>
      {allFields.length > 0 && children}
      {tableId && (
        <ExpandRecorder
          tableId={tableId}
          viewId={view?.id}
          recordId={expandRecordId}
          recordIds={getExpandRecordIds(expandRecordId, orderedRecordIds)}
          buttonClickStatusHook={buttonClickStatusHook}
          onClose={closeExpandRecord}
          onUpdateRecordIdCallback={setExpandRecordId}
          showHistory={showHistory}
          showComment={showComment}
        />
      )}
    </CalendarContext.Provider>
  );
};
