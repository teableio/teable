import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { NormalizedDotTeaStructure } from '../ports/DotTeaParser';
import { MAX_SELECTION_STREAM_BATCH_SIZE } from './shared/streamBatchSize';

export interface DuplicateBaseRecordInput {
  recordId?: string;
  fields: Record<string, unknown>;
  orders?: Record<string, number>;
  version?: number;
  autoNumber?: number;
  createdTime?: string;
  createdBy?: string;
  lastModifiedTime?: string;
  lastModifiedBy?: string;
}

export interface DuplicateBaseSource {
  structure: NormalizedDotTeaStructure;
  records(tableId: string): AsyncIterable<DuplicateBaseRecordInput>;
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
}

export interface DuplicateBaseErrorEvent {
  id: 'error';
  message: string;
  code?: string;
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
