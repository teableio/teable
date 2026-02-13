import type { IAttachmentCellValue } from '@teable/core';
import type { IConsumedPendingForCreate } from './use-attachment-upload-store';

interface IMergePendingAttachmentsForCreateParams {
  fields: { [fieldId: string]: unknown };
  tableId?: string;
  tempRecordId: string;
  consumePendingForCreate: (tableId: string, tempRecordId: string) => IConsumedPendingForCreate;
}

interface IMergePendingAttachmentsForCreateResult {
  mergedFields: { [fieldId: string]: unknown };
  consumedTaskIdsByCellKey: { [cellKey: string]: Set<string> };
}

export const mergePendingAttachmentsForCreate = ({
  fields,
  tableId,
  tempRecordId,
  consumePendingForCreate,
}: IMergePendingAttachmentsForCreateParams): IMergePendingAttachmentsForCreateResult => {
  if (!tableId) {
    return {
      mergedFields: { ...fields },
      consumedTaskIdsByCellKey: {},
    };
  }

  const mergedFields = { ...fields };
  const consumed = consumePendingForCreate(tableId, tempRecordId);

  Object.entries(consumed.completedByField).forEach(([fieldId, attachments]) => {
    const existing = (mergedFields[fieldId] as IAttachmentCellValue | undefined) || [];
    const existingIds = new Set(existing.map((item) => item.id));
    const newItems = attachments.filter((item) => !existingIds.has(item.id));
    if (newItems.length > 0) {
      mergedFields[fieldId] = [...existing, ...newItems];
    }
  });

  return {
    mergedFields,
    consumedTaskIdsByCellKey: consumed.consumedTaskIdsByCellKey,
  };
};

interface IFinalizePendingUploadAfterCreateParams {
  tableId?: string;
  tempRecordId: string;
  realRecordId?: string;
  consumedTaskIdsByCellKey: { [cellKey: string]: Set<string> };
  promoteToCell: (
    tableId: string,
    tempRecordId: string,
    realRecordId: string,
    consumedTaskIdsByCellKey?: { [cellKey: string]: Set<string> }
  ) => void;
}

export const finalizePendingUploadAfterCreate = ({
  tableId,
  tempRecordId,
  realRecordId,
  consumedTaskIdsByCellKey,
  promoteToCell,
}: IFinalizePendingUploadAfterCreateParams) => {
  if (!tableId || !realRecordId) return;
  promoteToCell(tableId, tempRecordId, realRecordId, consumedTaskIdsByCellKey);
};
