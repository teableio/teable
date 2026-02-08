import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { DomainError } from '../../../shared/DomainError';
import type { TableRecord } from '../../records/TableRecord';
import type { Table } from '../../Table';
import { calculateBatchSize } from './calculateBatchSize';
import { buildRecord } from './recordBuilders';

export interface CreateRecordsStreamOptions {
  /** Number of records per batch. If not specified, calculated dynamically based on field count. */
  batchSize?: number;
  /** Enable type conversion (e.g., "123" → 123 for number fields) */
  typecast?: boolean;
}

export function* createRecordsStream(
  this: Table,
  recordsFieldValues: Iterable<ReadonlyMap<string, unknown>>,
  options?: CreateRecordsStreamOptions
): Generator<Result<ReadonlyArray<TableRecord>, DomainError>> {
  const { typecast = false } = options ?? {};
  const batchSize = calculateBatchSize(this.getFields().length, options?.batchSize);
  let batch: TableRecord[] = [];

  for (const fieldValues of recordsFieldValues) {
    const recordResult = buildRecord.call(this, fieldValues, undefined, { typecast });
    if (recordResult.isErr()) {
      yield err(recordResult.error);
      return;
    }
    batch.push(recordResult.value);

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
