import { CellValueType, ColorConfigType, FieldType } from '@teable/core';
import { ExpandRecorder } from '@teable/sdk/components';
import { ShareViewContext } from '@teable/sdk/context';
import { useTableId, useView, useFields, useTablePermission } from '@teable/sdk/hooks';
import type { CalendarView, DateField } from '@teable/sdk/model';
import { useContext, useMemo, useState, type ReactNode } from 'react';
import { CalendarContext } from './CalendarContext';

export const CalendarProvider = ({ children }: { children: ReactNode }) => {
  const tableId = useTableId();
  const view = useView() as CalendarView | undefined;
  const { shareId } = useContext(ShareViewContext) ?? {};
  const { sort, filter } = view ?? {};
  const permission = useTablePermission();
  const allFields = useFields({ withHidden: true, withDenied: true });
  const { startDateFieldId, endDateFieldId, titleFieldId, colorConfig } = view?.options ?? {};
  const [expandRecordId, setExpandRecordId] = useState<string>();

  const recordQuery = useMemo(() => {
    if (!shareId || (!sort && !filter)) return;

    return {
      orderBy: sort?.sortObjs,
      filter: filter,
    };
  }, [shareId, sort, filter]);

  const { startDateField, endDateField, titleField } = useMemo(() => {
    const findDateField = (fieldId?: string | null) =>
      fieldId
        ? (allFields.find(
            (f) =>
              f.id === fieldId &&
              f.cellValueType === CellValueType.DateTime &&
              !f.isMultipleCellValue
          ) as DateField | undefined)
        : undefined;
    const titleField = titleFieldId
      ? allFields.find((f) => f.id === titleFieldId)
      : allFields.find((f) => f.isPrimary);

    const startField = findDateField(startDateFieldId);
    const endField = findDateField(endDateFieldId);

    return {
      startDateField: startField ?? endField,
      endDateField: endField ?? startField,
      titleField,
    };
  }, [startDateFieldId, endDateFieldId, titleFieldId, allFields]);

  const calendarPermission = useMemo(() => {
    return {
      eventCreatable: Boolean(permission['record|create']),
      eventEditable: Boolean(permission['record|update']),
      eventDeletable: Boolean(permission['record|delete']),
      eventDraggable: Boolean(permission['record|update']),
    };
  }, [permission]);

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
    };
  }, [
    recordQuery,
    startDateField,
    endDateField,
    titleField,
    colorField,
    colorConfig,
    calendarPermission,
  ]);

  return (
    <CalendarContext.Provider value={value}>
      {titleField && children}
      {tableId && (
        <ExpandRecorder
          tableId={tableId}
          viewId={view?.id}
          recordId={expandRecordId}
          recordIds={expandRecordId ? [expandRecordId] : []}
          onClose={() => setExpandRecordId(undefined)}
        />
      )}
    </CalendarContext.Provider>
  );
};
