import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { domainError, type DomainError } from '../../../shared/DomainError';
import { FieldByKeySpec } from '../../fields/specs/FieldByKeySpec';
import type { FieldKeyMapping } from '../../records/RecordCreateResult';
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
    // Resolve field keys to actual fields and build fieldKeyMapping
    const fieldKeyMapping: FieldKeyMapping = new Map();
    const resolvedFieldValues = new Map<string, unknown>();

    for (const [key, value] of fieldValues.entries()) {
      const spec = FieldByKeySpec.create(key);
      const fieldResult = table.getField(spec);

      if (fieldResult.isErr()) {
        return err(
          domainError.notFound({
            code: 'field.not_found',
            message: `Field not found: ${key}`,
          })
        );
      }

      const field = fieldResult.value;
      const fieldIdStr = field.id().toString();
      resolvedFieldValues.set(fieldIdStr, value);
      fieldKeyMapping.set(fieldIdStr, key);
    }

    const builder = RecordMutationSpecBuilder.create().withTypecast(typecast);
    const fields = table.getEditableFields();

    for (const field of fields) {
      const fieldIdStr = field.id().toString();
      if (!resolvedFieldValues.has(fieldIdStr)) continue;
      const providedValue = resolvedFieldValues.get(fieldIdStr);
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

    return ok(RecordUpdateResult.create(record, mutateSpec, fieldKeyMapping));
  });
}
