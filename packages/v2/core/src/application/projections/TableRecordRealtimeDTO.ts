import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';

/**
 * DTO for table record realtime documents.
 * Each record is stored as a separate ShareDB document in the `rec_{tableId}` collection.
 * Format matches V1 record snapshot structure for compatibility.
 */
export interface ITableRecordRealtimeDTO extends Pick<
  TableRecordReadModel,
  'createdByActorType' | 'createdByActorId' | 'lastModifiedByActorType' | 'lastModifiedByActorId'
> {
  /** Record ID */
  id: string;
  /** Field values as a flat map (fieldId -> value) for easy patching */
  fields: Record<string, unknown>;
}

export const unknownRecordRealtimeActors = {
  createdByActorType: null,
  createdByActorId: null,
  lastModifiedByActorType: null,
  lastModifiedByActorId: null,
};

export const recordCollectionPrefix = 'rec';

export const buildRecordCollection = (tableId: string): string =>
  `${recordCollectionPrefix}_${tableId}`;
