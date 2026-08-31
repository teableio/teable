import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { BulkCopyLinkValueColumn, BulkCopySourceLinkField } from '../ports/BaseDataBulkCopier';
import type { NormalizedDotTeaStructure } from '../ports/DotTeaParser';
import type { ITablePersistenceDTO } from '../ports/mappers/TableMapper';
import { MAX_SELECTION_STREAM_BATCH_SIZE } from './shared/streamBatchSize';

export interface DuplicateBaseRecordInput {
  recordId?: string;
  fields: Record<string, unknown>;
  orders?: Record<string, number>;
  version?: number;
  autoNumber?: number;
  createdTime?: string;
  createdBy?: string;
  lastModifiedTime?: string | null;
  lastModifiedBy?: string | null;
}

export type DuplicateBaseRecordReadPhase = 'insert' | 'linkRestore';

export interface DuplicateBaseRecordReadOptions {
  phase?: DuplicateBaseRecordReadPhase;
}

export interface DuplicateBaseSource {
  structure: NormalizedDotTeaStructure;
  /** Exact v2 snapshots for native duplication; portable imports may omit this map. */
  tableSnapshots?: ReadonlyMap<string, ITablePersistenceDTO>;
  /**
   * Physical `schema.table` names of source tables, keyed by source table id.
   * Present for native base duplication; portable imports omit it. Required for
   * the same-database bulk copy fast path.
   */
  sourceDbTableNameByTableId?: Record<string, string>;
  /**
   * Link value columns per source table id whose json values are downgraded to
   * title text during the physical copy (cross-base / disconnected links).
   */
  linkValueColumnsByTableId?: Record<string, ReadonlyArray<BulkCopyLinkValueColumn>>;
  /**
   * Physical storage info of source (non-lookup) link fields, pre-filtered by
   * the host for cross-base allowance and disconnected links. Drives junction
   * table copying during the bulk copy fast path.
   */
  sourceLinkFields?: ReadonlyArray<BulkCopySourceLinkField>;
  records(
    tableId: string,
    options?: DuplicateBaseRecordReadOptions
  ): AsyncIterable<DuplicateBaseRecordInput>;
}

export interface DuplicateBaseProgressEvent {
  id: 'progress';
  phase:
    | 'table_structure_started'
    | 'table_structure_done'
    | 'table_structure_validating'
    | 'table_structure_committing'
    | 'table_data_start'
    | 'table_data_progress'
    | 'table_data_done';
  tableId?: string;
  tableName?: string;
  tableIndex?: number;
  totalTables?: number;
  processedRows?: number;
  totalRows?: number;
  batchProcessedRows?: number;
  currentBatch?: number;
}

export interface DuplicateBaseDoneEvent {
  id: 'done';
  baseId: string;
  tableIdMap: Record<string, string>;
  fieldIdMap: Record<string, string>;
  viewIdMap: Record<string, string>;
  recordsLength: number;
  /**
   * How records were copied: same-database physical bulk copy, per-record
   * stream (cross-database), or not at all. The host recomputes persisted
   * computed columns only after a bulk copy.
   */
  recordCopyMode?: 'bulk' | 'stream' | 'none';
}

export interface DuplicateBaseErrorEvent {
  id: 'error';
  message: string;
  code?: string;
  /** In-process diagnostic; non-enumerable so streaming contracts stay stable. */
  error?: DomainError;
}

export type DuplicateBaseEvent =
  | DuplicateBaseProgressEvent
  | DuplicateBaseDoneEvent
  | DuplicateBaseErrorEvent;

export type DuplicateBaseResult = AsyncIterable<DuplicateBaseEvent>;

const duplicateBaseSourceSchema = z.object({
  baseId: z.string(),
  batchSize: z.number().int().min(1).max(MAX_SELECTION_STREAM_BATCH_SIZE).optional(),
  withRecords: z.boolean().default(true),
});

export class DuplicateBaseCommand {
  readonly __publicCommandBrand = 'public' as const;

  private constructor(
    readonly baseId: BaseId,
    readonly source: DuplicateBaseSource,
    readonly withRecords: boolean,
    readonly batchSize: number
  ) {}

  static createFromSource(input: {
    baseId: string;
    source: DuplicateBaseSource;
    withRecords?: boolean;
    batchSize?: number;
  }): Result<DuplicateBaseCommand, DomainError> {
    const parsed = duplicateBaseSourceSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid DuplicateBaseCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return BaseId.create(parsed.data.baseId).andThen((baseId) => {
      return ok(
        new DuplicateBaseCommand(
          baseId,
          input.source,
          parsed.data.withRecords,
          parsed.data.batchSize ?? 500
        )
      );
    });
  }
}
