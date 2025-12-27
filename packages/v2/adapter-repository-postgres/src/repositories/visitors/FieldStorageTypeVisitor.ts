import { FieldValueTypeVisitor } from '@teable/v2-core';
import type {
  AttachmentField,
  ButtonField,
  CheckboxField,
  DateField,
  Field,
  IFieldVisitor,
  LinkField,
  LongTextField,
  MultipleSelectField,
  NumberField,
  RatingField,
  SingleLineTextField,
  SingleSelectField,
  Table,
  UserField,
  FormulaField,
  RollupField,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export type IFieldStorageType = {
  cellValueType: string;
  dbFieldType: string;
  isMultipleCellValue: boolean;
};

export class FieldStorageTypeVisitor implements IFieldVisitor<IFieldStorageType> {
  private readonly typesByFieldId = new Map<string, IFieldStorageType>();
  private readonly valueTypeVisitor = new FieldValueTypeVisitor();

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
    return this.setTypeFromValueType(field);
  }

  visitLongTextField(field: LongTextField): Result<IFieldStorageType, string> {
    return this.setTypeFromValueType(field);
  }

  visitNumberField(field: NumberField): Result<IFieldStorageType, string> {
    return this.setTypeFromValueType(field);
  }

  visitRatingField(field: RatingField): Result<IFieldStorageType, string> {
    return this.setTypeFromValueType(field);
  }

  visitFormulaField(field: FormulaField): Result<IFieldStorageType, string> {
    return this.setTypeFromValueType(field);
  }

  visitRollupField(field: RollupField): Result<IFieldStorageType, string> {
    return this.setTypeFromValueType(field);
  }

  visitSingleSelectField(field: SingleSelectField): Result<IFieldStorageType, string> {
    return this.setTypeFromValueType(field);
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<IFieldStorageType, string> {
    return this.setTypeFromValueType(field);
  }

  visitCheckboxField(field: CheckboxField): Result<IFieldStorageType, string> {
    return this.setTypeFromValueType(field);
  }

  visitAttachmentField(field: AttachmentField): Result<IFieldStorageType, string> {
    return this.setTypeFromValueType(field);
  }

  visitDateField(field: DateField): Result<IFieldStorageType, string> {
    return this.setTypeFromValueType(field);
  }

  visitUserField(field: UserField): Result<IFieldStorageType, string> {
    return this.setTypeFromValueType(field);
  }

  visitButtonField(field: ButtonField): Result<IFieldStorageType, string> {
    return this.setTypeFromValueType(field);
  }

  visitLinkField(field: LinkField): Result<IFieldStorageType, string> {
    const valueTypeResult = field.accept(this.valueTypeVisitor);
    if (valueTypeResult.isErr()) return err(valueTypeResult.error);
    const { cellValueType, isMultipleCellValue } = valueTypeResult.value;
    const type: IFieldStorageType = {
      cellValueType: cellValueType.toString(),
      isMultipleCellValue: isMultipleCellValue.toBoolean(),
      dbFieldType: 'JSON',
    };
    this.typesByFieldId.set(field.id().toString(), type);
    return ok(type);
  }

  private setTypeFromValueType(field: Field): Result<IFieldStorageType, string> {
    const valueTypeResult = field.accept(this.valueTypeVisitor);
    if (valueTypeResult.isErr()) return err(valueTypeResult.error);
    const { cellValueType, isMultipleCellValue } = valueTypeResult.value;
    const type: IFieldStorageType = {
      cellValueType: cellValueType.toString(),
      isMultipleCellValue: isMultipleCellValue.toBoolean(),
      dbFieldType: resolveDbFieldType(
        field,
        cellValueType.toString(),
        isMultipleCellValue.toBoolean()
      ),
    };
    this.typesByFieldId.set(field.id().toString(), type);
    return ok(type);
  }
}

const resolveDbFieldType = (
  field: Field,
  cellValueType: string,
  isMultipleCellValue: boolean
): string => {
  if (isMultipleCellValue) return 'JSON';

  const fieldType = field.type().toString();
  if (['attachment', 'user', 'button'].includes(fieldType)) return 'JSON';

  switch (cellValueType) {
    case 'number':
      return 'REAL';
    case 'dateTime':
      return 'DATETIME';
    case 'boolean':
      return 'BOOLEAN';
    case 'string':
      return 'TEXT';
    default:
      return 'TEXT';
  }
};
