import {
  domainError,
  type DomainError,
  type Field,
  isBooleanField,
  isConditionalRollupField,
  isDateField,
  isFormulaField,
  isJsonValueField,
  isNumericField,
  isRollupField,
  match,
} from '@teable/v2-core';
import type { CreateTableBuilder } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
export type TableColumnDataType = Parameters<CreateTableBuilder<string, string>['addColumn']>[1];

export const resolveColumnName = (field: Field): Result<string, DomainError> => {
  return safeTry<string, DomainError>(function* () {
    const columnName = yield* field.dbFieldName().andThen((name) => name.value());
    return ok(columnName);
  }).mapErr((error) =>
    domainError.invariant({
      message: `Missing db field name for field ${field.id().toString()}: ${error.message}`,
      code: 'invariant.missing_db_field_name',
      details: { fieldId: field.id().toString(), cause: error.message },
    })
  );
};

export const resolveColumnType = (field: Field): Result<TableColumnDataType, DomainError> => {
  return match(field)
    .returnType<Result<TableColumnDataType, DomainError>>()
    .when(isFormulaField, (f) =>
      f
        .cellValueType()
        .andThen((cellValueType) =>
          f
            .isMultipleCellValue()
            .map((isMultiple) =>
              resolveFormulaColumnType(cellValueType.toString(), isMultiple.toBoolean())
            )
        )
    )
    .when(isRollupField, (f) =>
      f
        .cellValueType()
        .andThen((cellValueType) =>
          f
            .isMultipleCellValue()
            .map((isMultiple) =>
              resolveFormulaColumnType(cellValueType.toString(), isMultiple.toBoolean())
            )
        )
    )
    .when(isConditionalRollupField, (f) =>
      f
        .cellValueType()
        .andThen((cellValueType) =>
          f
            .isMultipleCellValue()
            .map((isMultiple) =>
              resolveFormulaColumnType(cellValueType.toString(), isMultiple.toBoolean())
            )
        )
    )
    .when(isJsonValueField, () => ok('jsonb'))
    .when(isNumericField, () => ok('double precision'))
    .when(isDateField, () => ok('timestamptz'))
    .when(isBooleanField, () => ok('boolean'))
    .otherwise(() => ok('text'));
};

const resolveFormulaColumnType = (
  cellValueType: string,
  isMultiple: boolean
): TableColumnDataType => {
  return match({ cellValueType, isMultiple })
    .returnType<TableColumnDataType>()
    .with({ isMultiple: true }, () => 'jsonb')
    .with({ cellValueType: 'number', isMultiple: false }, () => 'double precision')
    .with({ cellValueType: 'dateTime', isMultiple: false }, () => 'timestamptz')
    .with({ cellValueType: 'boolean', isMultiple: false }, () => 'boolean')
    .otherwise(() => 'text');
};
