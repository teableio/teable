import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { DomainError } from '../../../shared/DomainError';
import type { RecordId } from '../../records/RecordId';
import type { RecordUpdateResult } from '../../records/RecordUpdateResult';
import type { Table } from '../../Table';
import { calculateBatchSize } from './calculateBatchSize';
import { updateRecord } from './updateRecord';

export interface UpdateRecordItem {
  readonly recordId: RecordId;
  readonly fieldValues: ReadonlyMap<string, unknown>;
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
  options?: { typecast?: boolean; batchSize?: number }
): Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> {
  const { typecast = false } = options ?? {};
  const batchSize = calculateBatchSize(this.getFields().length, options?.batchSize);
  let batch: RecordUpdateResult[] = [];

  for (const { recordId, fieldValues } of updates) {
    // Use existing updateRecord method for each item
    const updateResult = updateRecord.call(this, recordId, fieldValues, { typecast });
    if (updateResult.isErr()) {
      yield err(updateResult.error);
      return;
    }
    batch.push(updateResult.value);

    if (batch.length >= batchSize) {
      yield ok(batch);
      batch = []; // Reset for next batch, allows GC to collect previous batch
    }
  }

  // Yield remaining records if any
  if (batch.length > 0) {
    yield ok(batch);
  }
}
