import { useQuery } from '@tanstack/react-query';
import type { ISelectFieldChoice, ISelectFieldOptions, IUserCellValue } from '@teable/core';
import { FieldType } from '@teable/core';
import { GroupPointType, getBaseCollaboratorList } from '@teable/openapi';
import { ExpandRecorder } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  useBase,
  useView,
  useFields,
  useTableId,
  useGroupPoint,
  useTablePermission,
} from '@teable/sdk/hooks';
import type {
  KanbanView,
  UserField,
  IFieldInstance,
  AttachmentField,
  SingleSelectField,
} from '@teable/sdk/model';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
  KANBAN_STACK_FIELD_TYPES,
  UNCATEGORIZED_STACK_ID,
  UNCATEGORIZED_STACK_NAME,
} from '../constant';
import { KanbanContext } from './KanbanContext';

export const KanbanProvider = ({ children }: { children: ReactNode }) => {
  const tableId = useTableId();
  const view = useView() as KanbanView | undefined;
  const { id: baseId } = useBase() ?? {};
  const permission = useTablePermission();
  const fields = useFields();
  const allFields = useFields({ withHidden: true });
  const { stackFieldId, coverFieldId, isCoverFit, isFieldNameHidden, isEmptyStackHidden } =
    view?.options ?? {};
  const [expandRecordId, setExpandRecordId] = useState<string>();
  const groupPoints = useGroupPoint();

  const stackField = useMemo(() => {
    if (!stackFieldId) return;
    return allFields.find(
      ({ id, type, isMultipleCellValue }) =>
        id === stackFieldId && KANBAN_STACK_FIELD_TYPES.has(type) && !isMultipleCellValue
    ) as SingleSelectField | UserField | undefined;
  }, [stackFieldId, allFields]);

  const { type: stackFieldType, options: stackFieldOptions } = stackField ?? {};

  const { data: userList } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId),
    queryFn: ({ queryKey }) => getBaseCollaboratorList(queryKey[1]),
    enabled: Boolean(baseId && stackFieldType === FieldType.User),
  });

  const kanbanPermission = useMemo(() => {
    return {
      stackCreatable: permission['field|update'],
      stackEditable: permission['field|update'],
      stackDeletable: permission['field|update'],
      stackDraggable: permission['field|update'],
      cardCreatable: permission['record|create'],
      cardEditable: permission['record|update'],
      cardDeletable: permission['record|delete'],
      cardDraggable: permission['record|update'],
    };
  }, [permission]);

  const groupPointMap = useMemo(() => {
    if (groupPoints == null || stackFieldType == null) return null;
    const isUserField = stackFieldType === FieldType.User;

    return groupPoints.reduce(
      (prev, cur, index) => {
        if (cur.type !== GroupPointType.Header) {
          return prev;
        }
        const { value } = cur;
        const key =
          value == null
            ? UNCATEGORIZED_STACK_ID
            : isUserField
              ? (value as IUserCellValue).id
              : value;
        const rowData = groupPoints[index + 1];

        if (rowData?.type !== GroupPointType.Row) {
          return prev;
        }

        const { count } = rowData;

        prev[key as string] = {
          count,
          data: value as IUserCellValue | string | null,
        };
        return prev;
      },
      {} as Record<string, { count: number; data: IUserCellValue | string | null }>
    );
  }, [groupPoints, stackFieldType]);

  const stackCollection = useMemo(() => {
    if (stackFieldType == null || groupPointMap == null) return;

    if (stackFieldType === FieldType.User) {
      const users = userList?.data;
      if (!users?.length) return;

      const stacks = users.map(({ userId, userName, avatar }) => {
        const data = groupPointMap[userId];
        return {
          id: userId,
          data: {
            id: userId,
            title: userName,
            avatarUrl: avatar,
          },
          count: data?.count ?? 0,
        };
      });

      stacks.unshift({
        id: UNCATEGORIZED_STACK_ID,
        data: {
          id: UNCATEGORIZED_STACK_ID,
          title: UNCATEGORIZED_STACK_NAME,
          avatarUrl: null,
        },
        count: groupPointMap[UNCATEGORIZED_STACK_ID]?.count ?? 0,
      });

      if (isEmptyStackHidden) {
        return stacks.filter(({ count }) => count > 0);
      }
      return stacks;
    }

    if (stackFieldType === FieldType.SingleSelect) {
      const { choices } = stackFieldOptions as ISelectFieldOptions;
      if (!choices?.length) return;

      const stacks = choices.map((choice) => {
        const { id, name } = choice;
        const data = groupPointMap[name];
        return {
          id,
          data: choice,
          count: data?.count ?? 0,
        };
      });

      stacks.unshift({
        id: UNCATEGORIZED_STACK_ID,
        data: {
          id: UNCATEGORIZED_STACK_ID,
          name: UNCATEGORIZED_STACK_NAME,
        } as ISelectFieldChoice,
        count: groupPointMap[UNCATEGORIZED_STACK_ID]?.count ?? 0,
      });

      if (isEmptyStackHidden) {
        return stacks.filter(({ count }) => count > 0);
      }
      return stacks;
    }
  }, [groupPointMap, isEmptyStackHidden, stackFieldOptions, stackFieldType, userList?.data]);

  const coverField = useMemo(() => {
    if (!coverFieldId) return;
    return allFields.find(
      ({ id, type }) => id === coverFieldId && type === FieldType.Attachment
    ) as AttachmentField | undefined;
  }, [coverFieldId, allFields]);

  const { primaryField, displayFields } = useMemo(() => {
    let primaryField: IFieldInstance | null = null;
    const displayFields = fields.filter((f) => {
      if (f.isPrimary) {
        primaryField = f;
        return false;
      }
      return true;
    });

    return {
      primaryField: primaryField as unknown as IFieldInstance,
      displayFields,
    };
  }, [fields]);

  const value = useMemo(() => {
    return {
      isCoverFit,
      isFieldNameHidden,
      permission: kanbanPermission,
      stackField,
      coverField,
      primaryField,
      displayFields,
      stackCollection,
      setExpandRecordId,
    };
  }, [
    isCoverFit,
    isFieldNameHidden,
    kanbanPermission,
    stackField,
    coverField,
    primaryField,
    displayFields,
    stackCollection,
    setExpandRecordId,
  ]);

  return (
    <KanbanContext.Provider value={value}>
      {children}
      {tableId && (
        <ExpandRecorder
          tableId={tableId}
          recordId={expandRecordId}
          recordIds={expandRecordId ? [expandRecordId] : []}
          onClose={() => setExpandRecordId(undefined)}
        />
      )}
    </KanbanContext.Provider>
  );
};
