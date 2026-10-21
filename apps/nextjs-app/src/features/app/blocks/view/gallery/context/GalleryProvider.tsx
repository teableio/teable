import { FieldType } from '@teable/core';
import { ExpandRecorder } from '@teable/sdk/components';
import { ShareViewContext } from '@teable/sdk/context';
import {
  useTableId,
  useView,
  useFields,
  useCommentPermission,
  useTablePermission,
  useButtonClickStatus,
  useDeepCompareMemoize,
} from '@teable/sdk/hooks';
import type { AttachmentField, GalleryView } from '@teable/sdk/model';
import { useRouter } from 'next/router';
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { GalleryContext } from './GalleryContext';

export const GalleryProvider = ({ children }: { children: ReactNode }) => {
  const tableId = useTableId();
  const view = useView() as GalleryView | undefined;
  const { shareId } = useContext(ShareViewContext) ?? {};
  const { sort, filter } = view ?? {};
  const permission = useTablePermission();
  const { commentReadable, commentWritable } = useCommentPermission();
  const fields = useFields();
  const readableFields = useFields({ withHidden: true });

  const { primaryField, displayFields } = useMemo(() => {
    // A stored config can hide the primary field, but it still titles every card:
    // resolve it from the readable set so the card area keeps rendering.
    const primaryField = readableFields.find((field) => field.isPrimary) ?? null;
    return {
      primaryField,
      displayFields: fields.filter((field) => !field.isPrimary),
    };
  }, [fields, readableFields]);
  const visibleFieldIds = useDeepCompareMemoize(
    fields.map(({ id }) => id).sort((a, b) => Number(a > b) - Number(a < b))
  ) as string[];
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
    // projection is a field-id set, not a sequence: keep it order-stable so
    // downstream cache keys don't churn when fields are reordered
    const ids = new Set(visibleFieldIds);
    if (coverField) ids.add(coverField.id);
    if (primaryField) ids.add(primaryField.id);
    return [...ids].sort((a, b) => Number(a > b) - Number(a < b));
  }, [coverField, primaryField, visibleFieldIds]);

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
      cardCommentReadable: commentReadable,
      cardCommentCreatable: commentWritable,
    };
  }, [permission, commentReadable, commentWritable]);
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
      {children}
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
