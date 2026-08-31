import {
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type ConditionalLookupField,
  type ConditionalRollupField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  type DomainError,
  type Field,
  type FormulaField,
  type IFieldVisitor,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LinkField,
  type LongTextField,
  type LookupField,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type RollupField,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
} from '@teable/v2-core';
import { sql, type AliasedRawBuilder } from 'kysely';
import type { Result } from 'neverthrow';

import { buildStoredFieldValueExpression } from './storedFieldValueExpression';

/**
 * Visitor that generates simple SELECT expressions for stored column values.
 * All fields are selected directly from the table without any computation.
 */
export class StoredFieldSelectVisitor implements IFieldVisitor<AliasedRawBuilder<unknown, string>> {
  constructor(private readonly tableAlias: string) {}

  private selectColumn(field: Field): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return field
      .dbFieldName()
      .andThen((dbFieldName) => dbFieldName.value())
      .map((colName) => sql`${sql.ref(`${this.tableAlias}.${colName}`)}`.as(colName));
  }

  private selectComputedColumn(
    field: Field
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return field
      .dbFieldName()
      .andThen((dbFieldName) => dbFieldName.value())
      .andThen((colName) =>
        buildStoredFieldValueExpression(field, this.tableAlias, colName).map(({ expression }) =>
          expression.as(colName)
        )
      );
  }

  visitSingleLineTextField(
    field: SingleLineTextField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitLongTextField(
    field: LongTextField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitNumberField(field: NumberField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitCheckboxField(
    field: CheckboxField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitDateField(field: DateField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitSingleSelectField(
    field: SingleSelectField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitUserField(field: UserField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitAttachmentField(
    field: AttachmentField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitCreatedTimeField(
    field: CreatedTimeField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitLastModifiedTimeField(
    field: LastModifiedTimeField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitAutoNumberField(
    field: AutoNumberField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitCreatedByField(
    field: CreatedByField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitLastModifiedByField(
    field: LastModifiedByField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitRatingField(field: RatingField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitButtonField(field: ButtonField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  // Computed fields use the stored value unless the field is currently errored.
  visitFormulaField(field: FormulaField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectComputedColumn(field);
  }

  visitLinkField(field: LinkField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectColumn(field);
  }

  visitLookupField(field: LookupField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectComputedColumn(field);
  }

  visitRollupField(field: RollupField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectComputedColumn(field);
  }

  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectComputedColumn(field);
  }

  visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.selectComputedColumn(field);
  }
}
