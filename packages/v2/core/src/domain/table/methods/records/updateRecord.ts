import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { domainError, type DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import { FieldByKeySpec } from '../../fields/specs/FieldByKeySpec';
import {
  FieldCellValueSchemaVisitor,
  type FieldCellValueSchema,
} from '../../fields/visitors/FieldCellValueSchemaVisitor';
import type { FieldKeyMapping } from '../../records/RecordCreateResult';
import type { RecordId } from '../../records/RecordId';
import { RecordMutationSpecBuilder } from '../../records/RecordMutationSpecBuilder';
import { RecordUpdateResult } from '../../records/RecordUpdateResult';
import { TableRecord } from '../../records/TableRecord';
import { TableRecordFields } from '../../records/TableRecordFields';
import type { Table } from '../../Table';

export type UpdateRecordTracePhase =
  | 'resolveFieldKeys'
  | 'configureMutationSpec'
  | 'buildMutationSpec'
  | 'createEmptyRecord'
  | 'mutateRecord'
  | 'createUpdateResult';

export interface UpdateRecordTraceEvent {
  readonly phase: UpdateRecordTracePhase;
  readonly recordIndex?: number;
  readonly fieldCount: number;
  readonly editableFieldCount?: number;
}

export type UpdateRecordTraceHook = <T>(
  event: UpdateRecordTraceEvent,
  callback: () => Result<T, DomainError>
) => Result<T, DomainError>;

export interface UpdateRecordOptions {
  readonly typecast?: boolean;
  readonly trace?: UpdateRecordTraceHook;
  readonly recordIndex?: number;
  readonly buildContext?: UpdateRecordBuildContext;
}

export interface UpdateRecordBuildContext {
  readonly fieldByKey: ReadonlyMap<string, Field>;
  readonly editableFieldById: ReadonlyMap<string, Field>;
  readonly editableFieldSchemaById: ReadonlyMap<string, FieldCellValueSchema>;
  readonly editableFieldCount: number;
}

export function createUpdateRecordBuildContext(table: Table): UpdateRecordBuildContext {
  const fieldByKey = new Map<string, Field>();
  const editableFieldById = new Map<string, Field>();
  const editableFieldSchemaById = new Map<string, FieldCellValueSchema>();
  const schemaVisitor = FieldCellValueSchemaVisitor.create();

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

  for (const field of table.getEditableFields()) {
    const fieldId = field.id().toString();
    editableFieldById.set(fieldId, field);
    const schemaResult = field.accept(schemaVisitor);
    if (schemaResult.isOk()) {
      editableFieldSchemaById.set(fieldId, schemaResult.value);
    }
  }

  return {
    fieldByKey,
    editableFieldById,
    editableFieldSchemaById,
    editableFieldCount: editableFieldById.size,
  };
}

export function updateRecord(
  this: Table,
  recordId: RecordId,
  fieldValues: ReadonlyMap<string, unknown>,
  options?: UpdateRecordOptions
): Result<RecordUpdateResult, DomainError> {
  const table = this;
  const { typecast = false, trace } = options ?? {};
  const recordIndex = options?.recordIndex;
  const buildContext = options?.buildContext;
  const runTrace = <T>(
    phase: UpdateRecordTracePhase,
    callback: () => Result<T, DomainError>,
    extra?: Pick<UpdateRecordTraceEvent, 'editableFieldCount'>
  ): Result<T, DomainError> => {
    const event: UpdateRecordTraceEvent = {
      phase,
      fieldCount: fieldValues.size,
      ...(recordIndex != null ? { recordIndex } : {}),
      ...extra,
    };
    return trace ? trace(event, callback) : callback();
  };

  return safeTry<RecordUpdateResult, DomainError>(function* () {
    // Resolve field keys to actual fields and build fieldKeyMapping
    const resolvedFields = yield* runTrace('resolveFieldKeys', () =>
      safeTry<
        {
          fieldKeyMapping: FieldKeyMapping;
          resolvedFieldValues: Map<string, unknown>;
        },
        DomainError
      >(function* () {
        const fieldKeyMapping: FieldKeyMapping = new Map();
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

        return ok({ fieldKeyMapping, resolvedFieldValues });
      })
    );
    const { fieldKeyMapping, resolvedFieldValues } = resolvedFields;

    const builder = RecordMutationSpecBuilder.create().withTypecast(typecast);
    const editableFields = buildContext ? undefined : table.getEditableFields();

    yield* runTrace(
      'configureMutationSpec',
      () => {
        if (buildContext) {
          for (const [fieldIdStr, providedValue] of resolvedFieldValues.entries()) {
            const field = buildContext.editableFieldById.get(fieldIdStr);
            if (!field) continue;
            if (providedValue === undefined) continue;
            builder.setWithSchema(
              field,
              providedValue,
              buildContext.editableFieldSchemaById.get(fieldIdStr)
            );
          }
          return ok(undefined);
        }

        for (const field of editableFields ?? []) {
          const fieldIdStr = field.id().toString();
          if (!resolvedFieldValues.has(fieldIdStr)) continue;
          const providedValue = resolvedFieldValues.get(fieldIdStr);
          if (providedValue === undefined) continue;
          builder.set(field, providedValue);
        }
        return ok(undefined);
      },
      { editableFieldCount: buildContext?.editableFieldCount ?? editableFields?.length }
    );

    if (builder.hasErrors()) {
      return err(builder.getErrors()[0]!);
    }

    const mutateSpec = yield* runTrace('buildMutationSpec', () => builder.build());

    const emptyRecord = yield* runTrace('createEmptyRecord', () =>
      TableRecordFields.create([]).andThen((emptyFields) =>
        TableRecord.create({
          id: recordId,
          tableId: table.id(),
          fieldValues: emptyFields.entries(),
        })
      )
    );

    const record = yield* runTrace('mutateRecord', () => mutateSpec.mutate(emptyRecord));

    const updateResult = yield* runTrace('createUpdateResult', () =>
      ok(RecordUpdateResult.create(record, mutateSpec, fieldKeyMapping))
    );
    return ok(updateResult);
  });
}
