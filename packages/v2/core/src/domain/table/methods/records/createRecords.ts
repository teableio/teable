import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { RecordCreateSource } from '../../events/RecordFieldValuesDTO';
import type { FieldKeyMapping } from '../../records/RecordCreateResult';
import type { RecordId } from '../../records/RecordId';
import type { ICellValueSpec } from '../../records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../../records/TableRecord';
import type { Table } from '../../Table';
import { buildRecordWithSpec, createRecordBuildContext } from './recordBuilders';

export interface CreateRecordsMethodResult {
  records: ReadonlyArray<TableRecord>;
  fieldKeyMapping: FieldKeyMapping;
  mutateSpecs: ReadonlyArray<ICellValueSpec | null>;
}

/** Opt-in row-data tolerance. Indices refer to the original input, never persisted rows. */
export interface RecordCreationValidation {
  readonly onInvalidDate: (recordIndex: number, field: Field) => void;
  readonly onInvalidRecord: (recordIndex: number, error: DomainError) => void;
}

const recoverableRecordCodes: Readonly<Record<string, true>> = {
  'validation.field.type_mismatch': true,
  'validation.field.out_of_range': true,
  'validation.field.invalid_date': true,
  'validation.field.invalid_option': true,
  'validation.field.invalid_options': true,
  'validation.field.invalid_link_format': true,
  'validation.field.invalid_user_format': true,
  'validation.field.invalid_attachment_format': true,
  'validation.field.invalid_value': true,
  'validation.field.not_null': true,
};

export const isRecoverableRecordDataError = (error: DomainError): boolean =>
  error.tags.includes('validation') && recoverableRecordCodes[error.code] === true;

export function createRecords(
  this: Table,
  recordsFieldValues: ReadonlyArray<
    ReadonlyMap<string, unknown> | { id?: RecordId; fieldValues: ReadonlyMap<string, unknown> }
  >,
  options?: {
    typecast?: boolean;
    valuesAreValidated?: boolean;
    emitRecordCreatedEvents?: boolean;
    source?: RecordCreateSource;
    recordValidation?: RecordCreationValidation;
  }
): Result<CreateRecordsMethodResult, DomainError> {
  const table = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
  const {
    typecast = false,
    valuesAreValidated = false,
    emitRecordCreatedEvents = true,
    source,
  } = options ?? {};
  return safeTry<CreateRecordsMethodResult, DomainError>(function* () {
    const buildContext = createRecordBuildContext(table, {
      validateRequired: options?.recordValidation !== undefined,
    });
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

    for (let recordIndex = 0; recordIndex < recordsFieldValues.length; recordIndex++) {
      const input = recordsFieldValues[recordIndex]!;
      const { fieldValues, recordId } = isSeedRecord(input)
        ? { fieldValues: input.fieldValues, recordId: input.id }
        : { fieldValues: input, recordId: undefined };
      const built = buildRecordWithSpec.call(table, fieldValues, recordId, {
        typecast,
        buildContext,
        valuesAreValidated,
        emitRecordCreatedEvent: emitRecordCreatedEvents,
        source,
        onInvalidDate: options?.recordValidation
          ? (field) => options.recordValidation!.onInvalidDate(recordIndex, field)
          : undefined,
        validateRequired: options?.recordValidation !== undefined,
      });
      if (built.isErr() && options?.recordValidation && isRecoverableRecordDataError(built.error)) {
        options.recordValidation.onInvalidRecord(recordIndex, built.error);
        continue;
      }
      const result = yield* built;
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
