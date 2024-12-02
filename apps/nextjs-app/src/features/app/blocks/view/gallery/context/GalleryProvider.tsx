import { FieldType } from '@teable/core';
import { ExpandRecorder } from '@teable/sdk/components';
import { ShareViewContext } from '@teable/sdk/context';
import { useTableId, useView, useFields, useTablePermission } from '@teable/sdk/hooks';
import type { AttachmentField, GalleryView, IFieldInstance } from '@teable/sdk/model';
import { useContext, useMemo, useState, type ReactNode } from 'react';
import { GalleryContext } from './GalleryContext';

export const GalleryProvider = ({ children }: { children: ReactNode }) => {
  const tableId = useTableId();
  const view = useView() as GalleryView | undefined;
  const { shareId } = useContext(ShareViewContext) ?? {};
  const { sort, filter } = view ?? {};
  const permission = useTablePermission();
  const fields = useFields();
  const allFields = useFields({ withHidden: true, withDenied: true });
  const { coverFieldId, isCoverFit, isFieldNameHidden } = view?.options ?? {};
  const [expandRecordId, setExpandRecordId] = useState<string>();

  const recordQuery = useMemo(() => {
    if (!shareId || (!sort && !filter)) return;

    return {
      orderBy: sort?.sortObjs,
      filter: filter,
    };
  }, [shareId, sort, filter]);

  const galleryPermission = useMemo(() => {
    return {
      cardCreatable: Boolean(permission['record|create']),
      cardEditable: Boolean(permission['record|update']),
      cardDeletable: Boolean(permission['record|delete']),
      cardDraggable: Boolean(permission['record|update'] && permission['view|update']),
    };
  }, [permission]);

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

  return (
    <GalleryContext.Provider value={value}>
      {primaryField && children}
      {tableId && (
        <ExpandRecorder
          tableId={tableId}
          viewId={view?.id}
          recordId={expandRecordId}
          recordIds={expandRecordId ? [expandRecordId] : []}
          onClose={() => setExpandRecordId(undefined)}
        />
      )}
    </GalleryContext.Provider>
  );
};
