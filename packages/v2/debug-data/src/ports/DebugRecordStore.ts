import type { DomainError, RecordId, TableId } from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type {
  DebugRawRecord,
  DebugRawRecordQueryOptions,
  DebugRawRecordQueryResult,
} from '../types';

export interface IDebugRecordStore {
  getRawRecords(
    tableId: TableId,
    options?: DebugRawRecordQueryOptions
  ): Promise<Result<DebugRawRecordQueryResult, DomainError>>;

  getRawRecord(
    tableId: TableId,
    recordId: RecordId
  ): Promise<Result<DebugRawRecord | null, DomainError>>;
}
