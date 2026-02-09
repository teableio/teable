import type { BaseId, DomainError, FieldId, TableId } from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type {
  DebugFieldMeta,
  DebugFieldSummary,
  DebugTableMeta,
  DebugTableSummary,
} from '../types';

export interface IDebugMetaStore {
  getTableMeta(tableId: TableId): Promise<Result<DebugTableMeta | null, DomainError>>;
  getTablesByBaseId(baseId: BaseId): Promise<Result<DebugTableMeta[], DomainError>>;
  getTableSummary(tableId: TableId): Promise<Result<DebugTableSummary | null, DomainError>>;
  getField(fieldId: FieldId): Promise<Result<DebugFieldMeta | null, DomainError>>;
  getFieldsByTableId(tableId: TableId): Promise<Result<DebugFieldMeta[], DomainError>>;
  getFieldSummariesByIds(
    fieldIds: ReadonlyArray<FieldId>
  ): Promise<Result<DebugFieldSummary[], DomainError>>;
  getTableSummariesByIds(
    tableIds: ReadonlyArray<TableId>
  ): Promise<Result<DebugTableSummary[], DomainError>>;
}
