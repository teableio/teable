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
  type FieldId,
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
  type Table,
  type UserField,
} from '@teable/v2-core';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

export type FieldOutputColumn = {
  readonly fieldId: FieldId;
  readonly columnAlias: string;
};

/**
 * Visitor to collect field id -> output column alias mapping.
 * Currently all fields use dbFieldName as the output alias,
 * but this can be extended in the future for different field types.
 */
export class FieldOutputColumnVisitor implements IFieldVisitor<FieldOutputColumn> {
  private readonly columns: FieldOutputColumn[] = [];

  /**
   * Collect output column mappings for all fields in a table.
   */
  collect(table: Table): Result<ReadonlyArray<FieldOutputColumn>, DomainError> {
    return safeTry<ReadonlyArray<FieldOutputColumn>, DomainError>(
      function* (this: FieldOutputColumnVisitor) {
        for (const field of table.getFields()) {
          yield* field.accept(this);
        }
        return ok([...this.columns]);
      }.bind(this)
    );
  }

  /**
   * Get the column alias for a single field.
   */
  getColumnAlias(field: Field): Result<string, DomainError> {
    return field.dbFieldName().andThen((dbFieldName) => dbFieldName.value());
  }

  private addColumn(field: Field): Result<FieldOutputColumn, DomainError> {
    return this.getColumnAlias(field).map((columnAlias) => {
      const column = { fieldId: field.id(), columnAlias };
      this.columns.push(column);
      return column;
    });
  }

  visitSingleLineTextField(field: SingleLineTextField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitLongTextField(field: LongTextField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitNumberField(field: NumberField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitCheckboxField(field: CheckboxField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitDateField(field: DateField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitSingleSelectField(field: SingleSelectField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitUserField(field: UserField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitAttachmentField(field: AttachmentField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitAutoNumberField(field: AutoNumberField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitCreatedByField(field: CreatedByField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitLastModifiedByField(field: LastModifiedByField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitRatingField(field: RatingField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitButtonField(field: ButtonField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitFormulaField(field: FormulaField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitLinkField(field: LinkField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitLookupField(field: LookupField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitRollupField(field: RollupField): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }

  visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<FieldOutputColumn, DomainError> {
    return this.addColumn(field);
  }
}
