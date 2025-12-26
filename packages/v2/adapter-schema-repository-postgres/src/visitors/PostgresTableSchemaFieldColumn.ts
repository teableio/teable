import {
  type Field,
  isBooleanField,
  isDateField,
  isFormulaField,
  isJsonValueField,
  isNumericField,
  match,
} from '@teable/v2-core';
import type { CreateTableBuilder } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

export type TableColumnDataType = Parameters<CreateTableBuilder<string, string>['addColumn']>[1];

export const resolveColumnName = (field: Field): Result<string, string> => {
  return safeTry<string, string>(function* () {
    const columnName = yield* field.dbFieldName().andThen((name) => name.value());
    return ok(columnName);
  }).mapErr((error) => `Missing db field name for field ${field.id().toString()}: ${error}`);
};

export const resolveColumnType = (field: Field): Result<TableColumnDataType, string> => {
  return match(field)
    .returnType<Result<TableColumnDataType, string>>()
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
