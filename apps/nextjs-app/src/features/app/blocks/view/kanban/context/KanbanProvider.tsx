import { useQuery } from '@tanstack/react-query';
import type { IUserCellValue } from '@teable/core';
import { FieldType } from '@teable/core';
import type { ListBaseCollaboratorRo } from '@teable/openapi';
import {
  getBaseCollaboratorList,
  getShareViewCollaborators,
  GroupPointType,
} from '@teable/openapi';
import { ExpandRecorder } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ShareViewContext } from '@teable/sdk/context';
import {
  useView,
  useFields,
  useTableId,
  useGroupPoint,
  useTablePermission,
  useFieldPermission,
  useBaseId,
} from '@teable/sdk/hooks';
import type { KanbanView, IFieldInstance, AttachmentField } from '@teable/sdk/model';
import type { ReactNode } from 'react';
import { useContext, useMemo, useState } from 'react';
import { UNCATEGORIZED_STACK_ID } from '../constant';
import { KanbanContext } from './KanbanContext';

const UNCATEGORIZED_STACK_DATA = {
  id: UNCATEGORIZED_STACK_ID,
  count: 0,
  data: null,
};

export const KanbanProvider = ({ children }: { children: ReactNode }) => {
  const tableId = useTableId();
  const view = useView() as KanbanView | undefined;
  const baseId = useBaseId() as string;
  const { shareId } = useContext(ShareViewContext) ?? {};
  const { sort, filter } = view ?? {};
  const permission = useTablePermission();
  const fields = useFields();
  const allFields = useFields({ withHidden: true, withDenied: true });
  const { stackFieldId, coverFieldId, isCoverFit, isFieldNameHidden, isEmptyStackHidden } =
    view?.options ?? {};
  const fieldPermission = useFieldPermission(stackFieldId);
  const [expandRecordId, setExpandRecordId] = useState<string>();
  const groupPoints = useGroupPoint();

  const recordQuery = useMemo(() => {
    if (!shareId || (!sort && !filter)) return;

    return {
      orderBy: sort?.sortObjs,
      filter: filter,
    };
  }, [shareId, sort, filter]);

  const stackField = useMemo(() => {
    if (!stackFieldId) return;
    return allFields.find(({ id }) => id === stackFieldId);
  }, [stackFieldId, allFields]);

  const { type, isMultipleCellValue } = stackField ?? {};

  const { data: userList } = useQuery({
    queryKey: shareId
      ? ReactQueryKeys.shareViewCollaborators(shareId)
      : ReactQueryKeys.baseCollaboratorList(baseId, { includeSystem: true }),
    queryFn: ({ queryKey }) =>
      shareId
        ? getShareViewCollaborators(queryKey[1], {}).then((data) => data.data)
        : getBaseCollaboratorList(queryKey[1], queryKey[2] as ListBaseCollaboratorRo).then(
            (data) => data.data
          ),
    enabled: Boolean((shareId || baseId) && type === FieldType.User && !isMultipleCellValue),
  });

  const kanbanPermission = useMemo(() => {
    return {
      stackCreatable: Boolean(fieldPermission['field|update']),
      stackEditable: Boolean(fieldPermission['field|update']),
      stackDeletable: Boolean(fieldPermission['field|update']),
      stackDraggable: Boolean(fieldPermission['field|update']),
      cardCreatable: Boolean(permission['record|create']),
      cardEditable: Boolean(permission['record|update']),
      cardDeletable: Boolean(permission['record|delete']),
      cardDraggable: Boolean(permission['record|update'] && permission['view|update']),
    };
  }, [permission, fieldPermission]);

  const stackCollection = useMemo(() => {
    if (groupPoints == null || stackField == null) return;

    const { type, options, isMultipleCellValue } = stackField;
    const isDisabledStackField = type === FieldType.Attachment;

    if (isDisabledStackField) return;

    const stackList: { id: string; count: number; data: unknown }[] = [];
    const stackMap: Record<string, { id: string; count: number; data: unknown }> = {};

    groupPoints.forEach((cur, index) => {
      if (cur.type !== GroupPointType.Header) return;

      const { id: groupId, value } = cur;
      const rowData = groupPoints[index + 1];

      if (rowData?.type !== GroupPointType.Row) return;
      if (value == null) return;

      const { count } = rowData;
      const obj = {
        id: groupId,
        count,
        data: value,
      };
      stackList.push(obj);

      if (type === FieldType.SingleSelect) {
        stackMap[value as string] = obj;
      }

      if (type === FieldType.User && !isMultipleCellValue) {
        stackMap[(value as IUserCellValue).id] = obj;
      }
    });

    if (type === FieldType.SingleSelect) {
      const choices = options?.choices;
      const stackList = choices.map(
        ({ id, name }) =>
          stackMap[name] ?? {
            id,
            count: 0,
            data: name,
          }
      );
      stackList.unshift(UNCATEGORIZED_STACK_DATA);
      return stackList;
    }

    if (type === FieldType.User && !isMultipleCellValue && userList) {
      const stackList = userList.map(
        ({ userId, userName, email, avatar }) =>
          stackMap[userId] ?? {
            id: userId,
            count: 0,
            data: {
              id: userId,
              title: userName,
              email,
              avatarUrl: avatar,
            },
          }
      );
      stackList.unshift(UNCATEGORIZED_STACK_DATA);
      return stackList;
    }

    stackList.unshift(UNCATEGORIZED_STACK_DATA);

    if (isEmptyStackHidden) {
      return stackList.filter(({ count }) => count > 0);
    }

    return stackList;
  }, [groupPoints, isEmptyStackHidden, stackField, userList]);

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
      recordQuery,
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
    recordQuery,
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
          viewId={view?.id}
          recordId={expandRecordId}
          recordIds={expandRecordId ? [expandRecordId] : []}
          onClose={() => setExpandRecordId(undefined)}
        />
      )}
    </KanbanContext.Provider>
  );
};
