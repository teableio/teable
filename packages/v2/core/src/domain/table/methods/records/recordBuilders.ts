import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { domainError, type DomainError } from '../../../shared/DomainError';
import { RecordCreated } from '../../events/RecordCreated';
import type { RecordCreateSource } from '../../events/RecordFieldValuesDTO';
import type { Field } from '../../fields/Field';
import { FieldType } from '../../fields/FieldType';
import { FieldByKeySpec } from '../../fields/specs/FieldByKeySpec';
import { FieldDefaultValueVisitor } from '../../fields/visitors/FieldDefaultValueVisitor';
import { RecordCreateResult } from '../../records/RecordCreateResult';
import { RecordId } from '../../records/RecordId';
import { RecordMutationSpecBuilder } from '../../records/RecordMutationSpecBuilder';
import { recordToFieldValues } from '../../records/recordToFieldValues';
import { TableRecord } from '../../records/TableRecord';
import { TableRecordFields } from '../../records/TableRecordFields';
import type { Table } from '../../Table';

interface CreateRecordEditableFieldContext {
  field: Field;
  fieldId: string;
  hasDefaultValue: boolean;
  defaultValue: unknown;
  isUserField: boolean;
}

export interface CreateRecordBuildContext {
  readonly fieldByKey: ReadonlyMap<string, Field>;
  readonly editableFields: ReadonlyArray<CreateRecordEditableFieldContext>;
}

export function createRecordBuildContext(table: Table): CreateRecordBuildContext {
  const fieldByKey = new Map<string, Field>();
  for (const field of table.getFields()) {
    const fieldId = field.id().toString();
    const fieldName = field.name().toString();
    if (!fieldByKey.has(fieldId)) {
      fieldByKey.set(fieldId, field);
    }
    if (!fieldByKey.has(fieldName)) {
      fieldByKey.set(fieldName, field);
    }
  }

  const defaultValueVisitor = FieldDefaultValueVisitor.create();
  const editableFields = table.getEditableFields().map((field) => {
    const defaultValueResult = field.accept(defaultValueVisitor);
    const defaultValue =
      defaultValueResult.isOk() && defaultValueResult.value !== undefined
        ? defaultValueResult.value
        : undefined;

    return {
      field,
      fieldId: field.id().toString(),
      hasDefaultValue: defaultValue !== undefined,
      defaultValue,
      isUserField: field.type().equals(FieldType.user()),
    } satisfies CreateRecordEditableFieldContext;
  });

  return {
    fieldByKey,
    editableFields,
  };
}

/**
 * Build a record with spec, supporting field keys that can be either fieldId or fieldName.
 *
 * @param fieldValues - Map where keys can be fieldId or fieldName
 * @param recordId - Optional record ID
 * @param options - Optional options (typecast)
 * @returns RecordCreateResult containing the record, mutation spec, and fieldKeyMapping
 */
export function buildRecordWithSpec(
  this: Table,
  fieldValues: ReadonlyMap<string, unknown>,
  recordId?: RecordId,
  options?: {
    typecast?: boolean;
    source?: RecordCreateSource;
    buildContext?: CreateRecordBuildContext;
    valuesAreValidated?: boolean;
    emitRecordCreatedEvent?: boolean;
  }
): Result<RecordCreateResult, DomainError> {
  const table = this;
  const {
    typecast = false,
    source = { type: 'user' },
    buildContext,
    valuesAreValidated = false,
    emitRecordCreatedEvent = true,
  } = options ?? {};
  return safeTry<RecordCreateResult, DomainError>(function* () {
    // 1. Generate a new record ID
    const resolvedRecordId = recordId ?? (yield* RecordId.generate());

    // 2. Resolve field keys to actual fields and build fieldKeyMapping
    // fieldKeyMapping: Map<fieldId, originalKey>
    const fieldKeyMapping = new Map<string, string>();
    const resolvedFieldValues = new Map<string, unknown>();

    for (const [key, value] of fieldValues.entries()) {
      const cachedField = buildContext?.fieldByKey.get(key);
      const fieldResult = cachedField
        ? ok(cachedField)
        : table.getField(FieldByKeySpec.create(key));

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

    // 3. Build mutation specs from resolved field values with default value support
    const builder = RecordMutationSpecBuilder.create().withTypecast(typecast);
    const fields = buildContext?.editableFields ?? createRecordBuildContext(table).editableFields;

    for (const field of fields) {
      const fieldIdStr = field.fieldId;
      const providedValue = resolvedFieldValues.get(fieldIdStr);

      // If value was explicitly provided (including null), use it
      if (resolvedFieldValues.has(fieldIdStr)) {
        if (valuesAreValidated) {
          builder.setValidated(field.field, providedValue);
        } else {
          builder.set(field.field, providedValue);
        }
      } else if (field.hasDefaultValue) {
        const defaultValue = field.defaultValue;
        if (field.isUserField && !typecast) {
          builder.withTypecast(true);
          builder.set(field.field, defaultValue);
          builder.withTypecast(typecast);
        } else {
          builder.set(field.field, defaultValue);
        }
      }
    }

    // 4. Check for validation errors before proceeding
    if (builder.hasErrors()) {
      return err(builder.getErrors()[0]!);
    }

    // 5. Create an empty record
    const emptyFields = yield* TableRecordFields.create([]);
    const emptyRecord = yield* TableRecord.create({
      id: resolvedRecordId,
      tableId: table.id(),
      fieldValues: emptyFields.entries(),
    });

    // 6. Apply mutation spec if there are any values to set
    if (builder.hasSpecs()) {
      const mutateSpec = yield* builder.build();
      const record = yield* mutateSpec.mutate(emptyRecord);

      if (emitRecordCreatedEvent) {
        table.addDomainEvent(
          RecordCreated.create({
            tableId: table.id(),
            baseId: table.baseId(),
            recordId: record.id(),
            fieldValues: recordToFieldValues(record),
            source,
          })
        );
      }

      return ok(RecordCreateResult.create(record, mutateSpec, fieldKeyMapping));
    }

    if (emitRecordCreatedEvent) {
      table.addDomainEvent(
        RecordCreated.create({
          tableId: table.id(),
          baseId: table.baseId(),
          recordId: emptyRecord.id(),
          fieldValues: recordToFieldValues(emptyRecord),
          source,
        })
      );
    }

    return ok(RecordCreateResult.create(emptyRecord, null, fieldKeyMapping));
  });
}

export function buildRecord(
  this: Table,
  fieldValues: ReadonlyMap<string, unknown>,
  recordId?: RecordId,
  options?: { typecast?: boolean; source?: RecordCreateSource }
): Result<TableRecord, DomainError> {
  return buildRecordWithSpec
    .call(this, fieldValues, recordId, options)
    .map((result) => result.record);
}
