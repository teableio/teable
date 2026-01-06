import {
  AbstractFieldVisitor,
  domainError,
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
import type { DynamicModule, DynamicReferenceBuilder } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

export type FieldColumn = {
  fieldId: FieldId;
  dbFieldName: string;
};

export class TableRecordSelectColumnsVisitor extends AbstractFieldVisitor<FieldColumn> {
  private readonly columns: FieldColumn[] = [];
  private readonly seen = new Set<string>();

  apply(table: Table): Result<ReadonlyArray<FieldColumn>, DomainError> {
    return safeTry<ReadonlyArray<FieldColumn>, DomainError>(
      function* (this: TableRecordSelectColumnsVisitor) {
        for (const field of table.getFields()) {
          yield* field.accept(this);
        }
        return ok(this.fieldColumns());
      }.bind(this)
    );
  }

  private fieldColumns(): ReadonlyArray<FieldColumn> {
    return [...this.columns];
  }

  selectColumns(
    dynamic: DynamicModule<unknown>,
    recordIdColumn: string
  ): ReadonlyArray<DynamicReferenceBuilder<string>> {
    return [
      dynamic.ref(recordIdColumn),
      ...this.columns.map((column) => dynamic.ref(column.dbFieldName)),
    ];
  }

  visitSingleLineTextField(field: SingleLineTextField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitLongTextField(field: LongTextField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitNumberField(field: NumberField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitRatingField(field: RatingField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitFormulaField(field: FormulaField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitRollupField(field: RollupField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitSingleSelectField(field: SingleSelectField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitCheckboxField(field: CheckboxField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitAttachmentField(field: AttachmentField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitDateField(field: DateField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitUserField(field: UserField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitCreatedByField(field: CreatedByField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitLastModifiedByField(field: LastModifiedByField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitAutoNumberField(field: AutoNumberField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitButtonField(field: ButtonField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitLinkField(field: LinkField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  override visitLookupField(field: LookupField): Result<FieldColumn, DomainError> {
    // Lookup fields need their own column, not delegation to inner field
    return this.addFieldColumn(field);
  }

  visitConditionalRollupField(field: ConditionalRollupField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  visitConditionalLookupField(field: ConditionalLookupField): Result<FieldColumn, DomainError> {
    return this.addFieldColumn(field);
  }

  private addFieldColumn(field: Field): Result<FieldColumn, DomainError> {
    return safeTry<FieldColumn, DomainError>(
      function* (this: TableRecordSelectColumnsVisitor) {
        const dbFieldName = yield* field.dbFieldName();
        const column = yield* dbFieldName.value();
        if (this.seen.has(column))
          return err(domainError.conflict({ message: 'Duplicate DbFieldName' }));
        this.seen.add(column);
        const next = { fieldId: field.id(), dbFieldName: column };
        this.columns.push(next);
        return ok(next);
      }.bind(this)
    );
  }
}
