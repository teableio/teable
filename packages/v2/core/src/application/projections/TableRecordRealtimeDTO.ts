/**
 * DTO for table record realtime documents.
 * Each record is stored as a separate ShareDB document in the `rec_{tableId}` collection.
 */
export interface ITableRecordRealtimeDTO {
  /** Record ID */
  id: string;
  /** Table ID this record belongs to */
  tableId: string;
  /** Field values as a flat map (fieldId -> value) for easy patching */
  fields: Record<string, unknown>;
}

export const recordCollectionPrefix = 'rec';

export const buildRecordCollection = (tableId: string): string =>
  `${recordCollectionPrefix}_${tableId}`;
