import type { TableRecordReadModel } from '@teable/v2-core';

export type RecordActorDto = Pick<
  TableRecordReadModel,
  'createdByActorType' | 'createdByActorId' | 'lastModifiedByActorType' | 'lastModifiedByActorId'
>;

/** Old adapters without a frozen attribution snapshot remain explicitly unknown. */
export const mapRecordActors = (record: RecordActorDto | undefined): RecordActorDto => ({
  createdByActorType: record?.createdByActorType ?? null,
  createdByActorId: record?.createdByActorId ?? null,
  lastModifiedByActorType: record?.lastModifiedByActorType ?? null,
  lastModifiedByActorId: record?.lastModifiedByActorId ?? null,
});
