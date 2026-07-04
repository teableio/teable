import { FieldType } from '@teable/core';
import { ExpandRecorder } from '@teable/sdk/components';
import { ShareViewContext } from '@teable/sdk/context';
import {
  useTableId,
  useView,
  useFields,
  useTablePermission,
  useButtonClickStatus,
  useDeepCompareMemoize,
} from '@teable/sdk/hooks';
import type { AttachmentField, GalleryView, IFieldInstance } from '@teable/sdk/model';
import { useRouter } from 'next/router';
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { GalleryContext } from './GalleryContext';

export const GalleryProvider = ({ children }: { children: ReactNode }) => {
  const tableId = useTableId();
  const view = useView() as GalleryView | undefined;
  const { shareId } = useContext(ShareViewContext) ?? {};
  const { sort, filter } = view ?? {};
  const permission = useTablePermission();
  const fields = useFields();
  const readableFields = useFields({ withHidden: true });
  const visibleFieldIds = useDeepCompareMemoize(fields.map(({ id }) => id).sort()) as string[];
  const { coverFieldId, isCoverFit, isFieldNameHidden } = view?.options ?? {};
  const [expandRecordId, setExpandRecordId] = useState<string>();
  const buttonClickStatusHook = useButtonClickStatus(tableId!, shareId);
  const router = useRouter();
  const {
    recordId: routerRecordId,
    showHistory: routerShowHistory,
    showComment: routerShowComment,
  } = router.query;
  const showHistory = routerShowHistory === 'true';
  const showComment = { true: true, false: false }[routerShowComment as string];

  useEffect(() => {
    setExpandRecordId(routerRecordId as string);
  }, [routerRecordId, setExpandRecordId]);

  const coverField = useMemo(() => {
    if (!coverFieldId) return;
    return readableFields.find(
      ({ id, type }) => id === coverFieldId && type === FieldType.Attachment
    ) as AttachmentField | undefined;
  }, [coverFieldId, readableFields]);

  const projectionFieldIds = useMemo(() => {
    if (!coverField) return visibleFieldIds;
    return Array.from(new Set([...visibleFieldIds, coverField.id]));
  }, [coverField, visibleFieldIds]);

  const recordQuery = useMemo(() => {
    // same contract as useRecords: search must only hit the fields this view
    // displays, so every record query in the gallery view declares it explicitly
    const baseQuery = {
      orderBy: sort?.sortObjs,
      filter: filter,
      projection: projectionFieldIds,
    };

    if (shareId) return baseQuery;

    return {
      ...baseQuery,
      ignoreViewQuery: true,
    };
  }, [shareId, sort, filter, projectionFieldIds]);

  const galleryPermission = useMemo(() => {
    return {
      cardCreatable: Boolean(permission['record|create']),
      cardEditable: Boolean(permission['record|update']),
      cardDeletable: Boolean(permission['record|delete']),
      cardDraggable: Boolean(permission['record|update'] && permission['view|update']),
      cardCommentCreatable: Boolean(permission['record|comment']),
    };
  }, [permission]);

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
      permission: galleryPermission,
      coverField,
      primaryField,
      displayFields,
      setExpandRecordId,
    };
  }, [
    recordQuery,
    isCoverFit,
    isFieldNameHidden,
    galleryPermission,
    coverField,
    primaryField,
    displayFields,
    setExpandRecordId,
  ]);

  const onClose = () => {
    setExpandRecordId(undefined);
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
    <GalleryContext.Provider value={value}>
      {primaryField && children}
      {tableId && (
        <ExpandRecorder
          tableId={tableId}
          viewId={view?.id}
          recordId={expandRecordId}
          recordIds={expandRecordId ? [expandRecordId] : []}
          onClose={onClose}
          buttonClickStatusHook={buttonClickStatusHook}
          showHistory={showHistory}
          showComment={showComment}
        />
      )}
    </GalleryContext.Provider>
  );
};
