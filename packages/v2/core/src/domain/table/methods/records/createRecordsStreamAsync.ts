import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { DomainError } from '../../../shared/DomainError';
import type { TableRecord } from '../../records/TableRecord';
import type { Table } from '../../Table';
import { calculateBatchSize } from './calculateBatchSize';
import { isRecoverableRecordDataError } from './createRecords';
import type { CreateRecordsStreamOptions } from './createRecordsStream';
import { buildRecord, createRecordBuildContext } from './recordBuilders';

export async function* createRecordsStreamAsync(
  this: Table,
  recordsFieldValues: AsyncIterable<ReadonlyMap<string, unknown>>,
  options?: CreateRecordsStreamOptions
): AsyncGenerator<Result<ReadonlyArray<TableRecord>, DomainError>> {
  const { typecast = false, emitRecordCreatedEvents = true } = options ?? {};
  const batchSize = calculateBatchSize(this.getFields().length, options?.batchSize);
  const buildContext = createRecordBuildContext(this, {
    freshDefaults: true,
    validateRequired: options?.recordValidation !== undefined,
  });
  let batch: TableRecord[] = [];
  let recordIndex = 0;

  for await (const fieldValues of recordsFieldValues) {
    const index = recordIndex++;
    const recordResult = buildRecord.call(this, fieldValues, undefined, {
      typecast,
      emitRecordCreatedEvent: emitRecordCreatedEvents,
      buildContext,
      onInvalidDate: options?.recordValidation
        ? (field) => options.recordValidation!.onInvalidDate(index, field)
        : undefined,
      validateRequired: options?.recordValidation !== undefined,
    });
    if (recordResult.isErr()) {
      if (options?.recordValidation && isRecoverableRecordDataError(recordResult.error)) {
        options.recordValidation.onInvalidRecord(index, recordResult.error);
        continue;
      }
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
