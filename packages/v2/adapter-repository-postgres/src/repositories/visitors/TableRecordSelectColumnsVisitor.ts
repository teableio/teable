import type {
  AttachmentField,
  AutoNumberField,
  ButtonField,
  CheckboxField,
  CreatedByField,
  CreatedTimeField,
  DateField,
  Field,
  FieldId,
  FormulaField,
  IFieldVisitor,
  LastModifiedByField,
  LastModifiedTimeField,
  LinkField,
  LongTextField,
  MultipleSelectField,
  NumberField,
  RatingField,
  RollupField,
  SingleLineTextField,
  SingleSelectField,
  Table,
  UserField,
} from '@teable/v2-core';
import type { DynamicModule, DynamicReferenceBuilder } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

export type FieldColumn = {
  fieldId: FieldId;
  dbFieldName: string;
};

export class TableRecordSelectColumnsVisitor implements IFieldVisitor<FieldColumn> {
  private readonly columns: FieldColumn[] = [];
  private readonly seen = new Set<string>();

  apply(table: Table): Result<ReadonlyArray<FieldColumn>, string> {
    return safeTry<ReadonlyArray<FieldColumn>, string>(
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

  visitSingleLineTextField(field: SingleLineTextField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitLongTextField(field: LongTextField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitNumberField(field: NumberField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitRatingField(field: RatingField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitFormulaField(field: FormulaField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitRollupField(field: RollupField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitSingleSelectField(field: SingleSelectField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitCheckboxField(field: CheckboxField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitAttachmentField(field: AttachmentField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitDateField(field: DateField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitUserField(field: UserField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitCreatedByField(field: CreatedByField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitLastModifiedByField(field: LastModifiedByField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitAutoNumberField(field: AutoNumberField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitButtonField(field: ButtonField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  visitLinkField(field: LinkField): Result<FieldColumn, string> {
    return this.addFieldColumn(field);
  }

  private addFieldColumn(field: Field): Result<FieldColumn, string> {
    return safeTry<FieldColumn, string>(
      function* (this: TableRecordSelectColumnsVisitor) {
        const dbFieldName = yield* field.dbFieldName();
        const column = yield* dbFieldName.value();
        if (this.seen.has(column)) return err('Duplicate DbFieldName');
        this.seen.add(column);
        const next = { fieldId: field.id(), dbFieldName: column };
        this.columns.push(next);
        return ok(next);
      }.bind(this)
    );
  }
}
