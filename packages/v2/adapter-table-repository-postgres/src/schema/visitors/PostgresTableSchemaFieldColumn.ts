import {
  AbstractFieldVisitor,
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type ConditionalLookupField,
  type ConditionalRollupField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  domainError,
  type DomainError,
  type Field,
  type FormulaField,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LinkField,
  type LongTextField,
  type LookupField,
  match,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type RollupField,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
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

const columnTypeVisitor = new (class extends AbstractFieldVisitor<TableColumnDataType> {
  visitSingleLineTextField(_field: SingleLineTextField): Result<TableColumnDataType, DomainError> {
    return ok('text');
  }

  visitLongTextField(_field: LongTextField): Result<TableColumnDataType, DomainError> {
    return ok('text');
  }

  visitNumberField(_field: NumberField): Result<TableColumnDataType, DomainError> {
    return ok('double precision');
  }

  visitRatingField(_field: RatingField): Result<TableColumnDataType, DomainError> {
    return ok('double precision');
  }

  visitFormulaField(field: FormulaField): Result<TableColumnDataType, DomainError> {
    return field
      .cellValueType()
      .andThen((cellValueType) =>
        field
          .isMultipleCellValue()
          .map((isMultiple) =>
            resolveFormulaColumnType(cellValueType.toString(), isMultiple.toBoolean())
          )
      );
  }

  visitRollupField(field: RollupField): Result<TableColumnDataType, DomainError> {
    return field
      .cellValueType()
      .andThen((cellValueType) =>
        field
          .isMultipleCellValue()
          .map((isMultiple) =>
            resolveFormulaColumnType(cellValueType.toString(), isMultiple.toBoolean())
          )
      );
  }

  visitSingleSelectField(_field: SingleSelectField): Result<TableColumnDataType, DomainError> {
    return ok('text');
  }

  visitMultipleSelectField(_field: MultipleSelectField): Result<TableColumnDataType, DomainError> {
    return ok('jsonb');
  }

  visitCheckboxField(_field: CheckboxField): Result<TableColumnDataType, DomainError> {
    return ok('boolean');
  }

  visitAttachmentField(_field: AttachmentField): Result<TableColumnDataType, DomainError> {
    return ok('jsonb');
  }

  visitDateField(_field: DateField): Result<TableColumnDataType, DomainError> {
    return ok('timestamptz');
  }

  visitCreatedTimeField(_field: CreatedTimeField): Result<TableColumnDataType, DomainError> {
    return ok('text');
  }

  visitLastModifiedTimeField(
    _field: LastModifiedTimeField
  ): Result<TableColumnDataType, DomainError> {
    return ok('text');
  }

  visitUserField(_field: UserField): Result<TableColumnDataType, DomainError> {
    return ok('jsonb');
  }

  visitCreatedByField(_field: CreatedByField): Result<TableColumnDataType, DomainError> {
    return ok('text');
  }

  visitLastModifiedByField(_field: LastModifiedByField): Result<TableColumnDataType, DomainError> {
    return ok('text');
  }

  visitAutoNumberField(_field: AutoNumberField): Result<TableColumnDataType, DomainError> {
    return ok('double precision');
  }

  visitButtonField(_field: ButtonField): Result<TableColumnDataType, DomainError> {
    return ok('jsonb');
  }

  visitLinkField(_field: LinkField): Result<TableColumnDataType, DomainError> {
    return ok('text');
  }

  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<TableColumnDataType, DomainError> {
    return field
      .cellValueType()
      .andThen((cellValueType) =>
        field
          .isMultipleCellValue()
          .map((isMultiple) =>
            resolveFormulaColumnType(cellValueType.toString(), isMultiple.toBoolean())
          )
      );
  }

  visitLookupField(_field: LookupField): Result<TableColumnDataType, DomainError> {
    return ok('jsonb');
  }

  visitConditionalLookupField(
    _field: ConditionalLookupField
  ): Result<TableColumnDataType, DomainError> {
    return ok('jsonb');
  }
})();

export const resolveColumnType = (field: Field): Result<TableColumnDataType, DomainError> => {
  return field.accept(columnTypeVisitor);
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
