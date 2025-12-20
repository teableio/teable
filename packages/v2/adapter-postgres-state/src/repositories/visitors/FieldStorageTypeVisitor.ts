import type {
  AttachmentField,
  ButtonField,
  CheckboxField,
  DateField,
  Field,
  IFieldVisitor,
  LongTextField,
  MultipleSelectField,
  NumberField,
  RatingField,
  SingleLineTextField,
  SingleSelectField,
  Table,
  UserField,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export type IFieldStorageType = {
  cellValueType: string;
  dbFieldType: string;
};

export class FieldStorageTypeVisitor implements IFieldVisitor<IFieldStorageType> {
  private readonly typesByFieldId = new Map<string, IFieldStorageType>();

  private static isFieldArray(value: Table | ReadonlyArray<Field>): value is ReadonlyArray<Field> {
    return Array.isArray(value);
  }

  apply(table: Table): Result<void, string>;
  apply(fields: ReadonlyArray<Field>): Result<void, string>;
  apply(tableOrFields: Table | ReadonlyArray<Field>): Result<void, string> {
    const fields = FieldStorageTypeVisitor.isFieldArray(tableOrFields)
      ? tableOrFields
      : tableOrFields.fields();

    for (const field of fields) {
      const result = field.accept(this);
      if (result.isErr()) return err(result.error);
    }

    return ok(undefined);
  }

  typesById(): ReadonlyMap<string, IFieldStorageType> {
    return new Map(this.typesByFieldId);
  }

  visitSingleLineTextField(field: SingleLineTextField): Result<IFieldStorageType, string> {
    return this.setType(field, { cellValueType: 'string', dbFieldType: 'TEXT' });
  }

  visitLongTextField(field: LongTextField): Result<IFieldStorageType, string> {
    return this.setType(field, { cellValueType: 'string', dbFieldType: 'TEXT' });
  }

  visitNumberField(field: NumberField): Result<IFieldStorageType, string> {
    return this.setType(field, { cellValueType: 'number', dbFieldType: 'REAL' });
  }

  visitRatingField(field: RatingField): Result<IFieldStorageType, string> {
    return this.setType(field, { cellValueType: 'number', dbFieldType: 'REAL' });
  }

  visitSingleSelectField(field: SingleSelectField): Result<IFieldStorageType, string> {
    return this.setType(field, { cellValueType: 'string', dbFieldType: 'TEXT' });
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<IFieldStorageType, string> {
    return this.setType(field, { cellValueType: 'string', dbFieldType: 'JSON' });
  }

  visitCheckboxField(field: CheckboxField): Result<IFieldStorageType, string> {
    return this.setType(field, { cellValueType: 'boolean', dbFieldType: 'BOOLEAN' });
  }

  visitAttachmentField(field: AttachmentField): Result<IFieldStorageType, string> {
    return this.setType(field, { cellValueType: 'string', dbFieldType: 'JSON' });
  }

  visitDateField(field: DateField): Result<IFieldStorageType, string> {
    return this.setType(field, { cellValueType: 'dateTime', dbFieldType: 'DATETIME' });
  }

  visitUserField(field: UserField): Result<IFieldStorageType, string> {
    return this.setType(field, { cellValueType: 'string', dbFieldType: 'JSON' });
  }

  visitButtonField(field: ButtonField): Result<IFieldStorageType, string> {
    return this.setType(field, { cellValueType: 'string', dbFieldType: 'JSON' });
  }

  private setType(field: Field, type: IFieldStorageType): Result<IFieldStorageType, string> {
    this.typesByFieldId.set(field.id().toString(), type);
    return ok(type);
  }
}
