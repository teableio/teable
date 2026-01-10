import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { DomainError } from '../../../shared/DomainError';
import type { TableRecord } from '../../records/TableRecord';
import type { Table } from '../../Table';
import { buildRecord } from './recordBuilders';

export async function* createRecordsStreamAsync(
  this: Table,
  recordsFieldValues: AsyncIterable<ReadonlyMap<string, unknown>>,
  options?: { batchSize?: number }
): AsyncGenerator<Result<ReadonlyArray<TableRecord>, DomainError>> {
  const batchSize = options?.batchSize ?? 500;
  let batch: TableRecord[] = [];

  for await (const fieldValues of recordsFieldValues) {
    const recordResult = buildRecord.call(this, fieldValues);
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
