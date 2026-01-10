import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { DomainError } from '../../../shared/DomainError';
import { FieldDefaultValueVisitor } from '../../fields/visitors/FieldDefaultValueVisitor';
import { RecordCreateResult } from '../../records/RecordCreateResult';
import { RecordId } from '../../records/RecordId';
import { RecordMutationSpecBuilder } from '../../records/RecordMutationSpecBuilder';
import { TableRecord } from '../../records/TableRecord';
import { TableRecordFields } from '../../records/TableRecordFields';
import type { Table } from '../../Table';

export function buildRecordWithSpec(
  this: Table,
  fieldValues: ReadonlyMap<string, unknown>,
  recordId?: RecordId,
  options?: { typecast?: boolean }
): Result<RecordCreateResult, DomainError> {
  const table = this;
  const { typecast = false } = options ?? {};
  return safeTry<RecordCreateResult, DomainError>(function* () {
    // 1. Generate a new record ID
    const resolvedRecordId = recordId ?? (yield* RecordId.generate());

    // 2. Build mutation specs from field values with default value support
    const builder = RecordMutationSpecBuilder.create().withTypecast(typecast);
    const fields = table.getEditableFields();
    const defaultValueVisitor = FieldDefaultValueVisitor.create();

    for (const field of fields) {
      const fieldIdStr = field.id().toString();
      const providedValue = fieldValues.get(fieldIdStr);

      // If value was explicitly provided (even if null), use it
      if (fieldValues.has(fieldIdStr) && providedValue !== undefined && providedValue !== null) {
        builder.set(field, providedValue);
      } else {
        // Otherwise, try to get the default value
        const defaultValueResult = field.accept(defaultValueVisitor);
        if (defaultValueResult.isOk()) {
          const defaultValue = defaultValueResult.value;
          if (defaultValue !== undefined) {
            builder.set(field, defaultValue);
          }
        }
      }
    }

    // 3. Check for validation errors before proceeding
    if (builder.hasErrors()) {
      return err(builder.getErrors()[0]!);
    }

    // 4. Create an empty record
    const emptyFields = yield* TableRecordFields.create([]);
    const emptyRecord = yield* TableRecord.create({
      id: resolvedRecordId,
      tableId: table.id(),
      fieldValues: emptyFields.entries(),
    });

    // 5. Apply mutation spec if there are any values to set
    if (builder.hasSpecs()) {
      const mutateSpec = yield* builder.build();
      const record = yield* mutateSpec.mutate(emptyRecord);
      return ok(RecordCreateResult.create(record, mutateSpec));
    }
    return ok(RecordCreateResult.create(emptyRecord, null));
  });
}

export function buildRecord(
  this: Table,
  fieldValues: ReadonlyMap<string, unknown>,
  recordId?: RecordId,
  options?: { typecast?: boolean }
): Result<TableRecord, DomainError> {
  return buildRecordWithSpec
    .call(this, fieldValues, recordId, options)
    .map((result) => result.record);
}
