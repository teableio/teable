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
import { useRouter } from 'next/router';
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  const [expandRecordId, setExpandRecordId] = useState<string>();
  const buttonClickStatusHook = useButtonClickStatus(tableId!, shareId);
  const router = useRouter();
  const { recordId: routerRecordId } = router.query;

  // The same route sync kanban and gallery already do: a `?recordId=` link — the one the
  // expand panel's copy button hands out — has to open that record when the calendar loads,
  // and closing the panel has to take it back out of the url.
  useEffect(() => {
    setExpandRecordId(routerRecordId as string);
  }, [routerRecordId, setExpandRecordId]);

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

  const onClose = () => {
    setExpandRecordId(undefined);
    // an event click never touched the url, so there is nothing to clean up
    if (!routerRecordId) return;
    const {
      recordId: _recordId,
      showHistory: _showHistory,
      showComment: _showComment,
      ...resetQuery
    } = router.query;
    router.push(
      {
        pathname: router.pathname,
        query: resetQuery,
      },
      undefined,
      {
        shallow: true,
      }
    );
  };

  return (
    <CalendarContext.Provider value={value}>
      {allFields.length > 0 && children}
      {tableId && (
        <ExpandRecorder
          tableId={tableId}
          viewId={view?.id}
          recordId={expandRecordId}
          recordIds={expandRecordId ? [expandRecordId] : []}
          buttonClickStatusHook={buttonClickStatusHook}
          onClose={onClose}
        />
      )}
    </CalendarContext.Provider>
  );
};
