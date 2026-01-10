import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { DomainError } from '../../../shared/DomainError';
import type { RecordId } from '../../records/RecordId';
import type { TableRecord } from '../../records/TableRecord';
import type { Table } from '../../Table';
import { buildRecord } from './recordBuilders';

export function createRecords(
  this: Table,
  recordsFieldValues: ReadonlyArray<
    ReadonlyMap<string, unknown> | { id?: RecordId; fieldValues: ReadonlyMap<string, unknown> }
  >
): Result<ReadonlyArray<TableRecord>, DomainError> {
  const table = this;
  return safeTry<ReadonlyArray<TableRecord>, DomainError>(function* () {
    const records: TableRecord[] = [];
    const isSeedRecord = (
      input:
        | ReadonlyMap<string, unknown>
        | { id?: RecordId; fieldValues: ReadonlyMap<string, unknown> }
    ): input is { id?: RecordId; fieldValues: ReadonlyMap<string, unknown> } =>
      typeof input === 'object' && input !== null && 'fieldValues' in input;

    for (const input of recordsFieldValues) {
      const { fieldValues, recordId } = isSeedRecord(input)
        ? { fieldValues: input.fieldValues, recordId: input.id }
        : { fieldValues: input, recordId: undefined };
      const record = yield* buildRecord.call(table, fieldValues, recordId);
      records.push(record);
    }
    return ok(records);
  });
}
