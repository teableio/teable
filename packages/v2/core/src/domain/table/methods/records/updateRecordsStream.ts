import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { DomainError } from '../../../shared/DomainError';
import type { RecordId } from '../../records/RecordId';
import type { RecordUpdateResult } from '../../records/RecordUpdateResult';
import type { Table } from '../../Table';
import { calculateBatchSize } from './calculateBatchSize';
import {
  createUpdateRecordBuildContext,
  updateRecord,
  type UpdateRecordBuildContext,
  type UpdateRecordTraceHook,
} from './updateRecord';

export interface UpdateRecordItem {
  readonly recordId: RecordId;
  readonly fieldValues: ReadonlyMap<string, unknown>;
}

export type UpdateRecordsStreamTracePhase = 'updateRecord' | 'yieldBatch' | 'yieldFinalBatch';

export interface UpdateRecordsStreamTraceEvent {
  readonly phase: UpdateRecordsStreamTracePhase;
  readonly recordIndex?: number;
  readonly batchIndex: number;
  readonly batchSize: number;
  readonly fieldCount?: number;
  readonly targetBatchSize: number;
}

export type UpdateRecordsStreamTraceHook = <T>(
  event: UpdateRecordsStreamTraceEvent,
  callback: () => T
) => T;

export interface UpdateRecordsStreamOptions {
  readonly typecast?: boolean;
  readonly batchSize?: number;
  readonly maxBatchSize?: number;
  readonly trace?: UpdateRecordsStreamTraceHook;
  readonly traceRecord?: UpdateRecordTraceHook;
  readonly buildContext?: UpdateRecordBuildContext;
}

/**
 * Generates batched RecordUpdateResults from an iterable of update items.
 *
 * This method is memory-efficient for bulk updates:
 * - Processes items from the iterable one at a time
 * - Yields batched results to allow Repository to use batch SQL
 * - Errors halt the generator immediately
 *
 * @param updates - Iterable of { recordId, fieldValues } items
 * @param options - Options including typecast and batchSize (if not specified, calculated dynamically based on field count)
 * @returns Generator yielding batched RecordUpdateResult arrays
 */
export function* updateRecordsStream(
  this: Table,
  updates: Iterable<UpdateRecordItem>,
  options?: UpdateRecordsStreamOptions
): Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> {
  const { typecast = false, trace, traceRecord } = options ?? {};
  const buildContext = options?.buildContext ?? createUpdateRecordBuildContext(this);
  const batchSize = calculateBatchSize(this.getFields().length, {
    userBatchSize: options?.batchSize,
    maxBatchSize: options?.maxBatchSize,
  });
  let batch: RecordUpdateResult[] = [];
  let batchIndex = 0;
  let recordIndex = 0;

  const runTrace = <T>(event: UpdateRecordsStreamTraceEvent, callback: () => T): T =>
    trace ? trace(event, callback) : callback();

  for (const { recordId, fieldValues } of updates) {
    // Use existing updateRecord method for each item
    const updateResult = runTrace(
      {
        phase: 'updateRecord',
        recordIndex,
        batchIndex,
        batchSize: batch.length,
        fieldCount: fieldValues.size,
        targetBatchSize: batchSize,
      },
      () =>
        updateRecord.call(this, recordId, fieldValues, {
          typecast,
          trace: traceRecord,
          recordIndex,
          buildContext,
        })
    );
    if (updateResult.isErr()) {
      yield err(updateResult.error);
      return;
    }
    batch.push(updateResult.value);
    recordIndex += 1;

    if (batch.length >= batchSize) {
      yield runTrace(
        {
          phase: 'yieldBatch',
          batchIndex,
          batchSize: batch.length,
          targetBatchSize: batchSize,
        },
        () => ok(batch)
      );
      batch = []; // Reset for next batch, allows GC to collect previous batch
      batchIndex += 1;
    }
  }

  // Yield remaining records if any
  if (batch.length > 0) {
    yield runTrace(
      {
        phase: 'yieldFinalBatch',
        batchIndex,
        batchSize: batch.length,
        targetBatchSize: batchSize,
      },
      () => ok(batch)
    );
  }
}
