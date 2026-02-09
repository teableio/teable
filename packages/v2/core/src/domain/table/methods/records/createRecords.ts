import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { DomainError } from '../../../shared/DomainError';
import type { FieldKeyMapping } from '../../records/RecordCreateResult';
import type { RecordId } from '../../records/RecordId';
import type { ICellValueSpec } from '../../records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../../records/TableRecord';
import type { Table } from '../../Table';
import { buildRecordWithSpec } from './recordBuilders';

export interface CreateRecordsMethodResult {
  records: ReadonlyArray<TableRecord>;
  fieldKeyMapping: FieldKeyMapping;
  mutateSpecs: ReadonlyArray<ICellValueSpec | null>;
}

export function createRecords(
  this: Table,
  recordsFieldValues: ReadonlyArray<
    ReadonlyMap<string, unknown> | { id?: RecordId; fieldValues: ReadonlyMap<string, unknown> }
  >,
  options?: { typecast?: boolean }
): Result<CreateRecordsMethodResult, DomainError> {
  const table = this;
  const { typecast = false } = options ?? {};
  return safeTry<CreateRecordsMethodResult, DomainError>(function* () {
    const records: TableRecord[] = [];
    const mutateSpecs: (ICellValueSpec | null)[] = [];
    // Combined fieldKeyMapping from all records
    const fieldKeyMapping: FieldKeyMapping = new Map();

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
      const result = yield* buildRecordWithSpec.call(table, fieldValues, recordId, { typecast });
      records.push(result.record);
      mutateSpecs.push(result.mutateSpec);
      // Merge fieldKeyMapping (all records should have the same mapping for the same fields)
      for (const [fieldId, originalKey] of result.fieldKeyMapping) {
        fieldKeyMapping.set(fieldId, originalKey);
      }
    }
    return ok({ records, fieldKeyMapping, mutateSpecs });
  });
}
