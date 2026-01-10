import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { DomainError } from '../../../shared/DomainError';
import type { RecordId } from '../../records/RecordId';
import { RecordMutationSpecBuilder } from '../../records/RecordMutationSpecBuilder';
import { RecordUpdateResult } from '../../records/RecordUpdateResult';
import { TableRecord } from '../../records/TableRecord';
import { TableRecordFields } from '../../records/TableRecordFields';
import type { Table } from '../../Table';

export function updateRecord(
  this: Table,
  recordId: RecordId,
  fieldValues: ReadonlyMap<string, unknown>,
  options?: { typecast?: boolean }
): Result<RecordUpdateResult, DomainError> {
  const table = this;
  const { typecast = false } = options ?? {};
  return safeTry<RecordUpdateResult, DomainError>(function* () {
    const builder = RecordMutationSpecBuilder.create().withTypecast(typecast);
    const fields = table.getEditableFields();

    for (const field of fields) {
      const fieldIdStr = field.id().toString();
      if (!fieldValues.has(fieldIdStr)) continue;
      const providedValue = fieldValues.get(fieldIdStr);
      if (providedValue === undefined) continue;
      builder.set(field, providedValue);
    }

    if (builder.hasErrors()) {
      return err(builder.getErrors()[0]!);
    }

    const mutateSpec = yield* builder.build();

    const emptyFields = yield* TableRecordFields.create([]);
    const emptyRecord = yield* TableRecord.create({
      id: recordId,
      tableId: table.id(),
      fieldValues: emptyFields.entries(),
    });

    const record = yield* mutateSpec.mutate(emptyRecord);

    return ok(RecordUpdateResult.create(record, mutateSpec));
  });
}
