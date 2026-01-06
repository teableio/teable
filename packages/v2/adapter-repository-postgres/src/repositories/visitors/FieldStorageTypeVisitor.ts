import {
  AbstractFieldVisitor,
  AttachmentField,
  AutoNumberField,
  ButtonField,
  CheckboxField,
  type ConditionalLookupField,
  type ConditionalRollupField,
  CreatedByField,
  CreatedTimeField,
  DateField,
  type DomainError,
  Field,
  FieldValueTypeVisitor,
  FormulaField,
  LastModifiedByField,
  LastModifiedTimeField,
  LinkField,
  LongTextField,
  LookupField,
  MultipleSelectField,
  NumberField,
  RatingField,
  RollupField,
  SingleLineTextField,
  SingleSelectField,
  Table,
  UserField,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

const jsonSpecResult = Field.specs().isJson().build();

const fieldIsJson = (field: Field): boolean => {
  if (jsonSpecResult.isErr()) return false;
  return jsonSpecResult.value.isSatisfiedBy(field);
};

export type IFieldStorageType = {
  cellValueType: string;
  dbFieldType: string;
  isMultipleCellValue: boolean;
};

export class FieldStorageTypeVisitor extends AbstractFieldVisitor<IFieldStorageType> {
  private readonly typesByFieldId = new Map<string, IFieldStorageType>();
  private readonly valueTypeVisitor = new FieldValueTypeVisitor();

  private static isFieldArray(value: Table | ReadonlyArray<Field>): value is ReadonlyArray<Field> {
    return Array.isArray(value);
  }

  apply(table: Table): Result<void, DomainError>;
  apply(fields: ReadonlyArray<Field>): Result<void, DomainError>;
  apply(tableOrFields: Table | ReadonlyArray<Field>): Result<void, DomainError> {
    const fields = FieldStorageTypeVisitor.isFieldArray(tableOrFields)
      ? tableOrFields
      : tableOrFields.getFields();

    for (const field of fields) {
      const result = field.accept(this);
      if (result.isErr()) return err(result.error);
    }

    return ok(undefined);
  }

  typesById(): ReadonlyMap<string, IFieldStorageType> {
    return new Map(this.typesByFieldId);
  }

  visitSingleLineTextField(field: SingleLineTextField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitLongTextField(field: LongTextField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitNumberField(field: NumberField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitRatingField(field: RatingField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitFormulaField(field: FormulaField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitRollupField(field: RollupField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitSingleSelectField(field: SingleSelectField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitCheckboxField(field: CheckboxField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitAttachmentField(field: AttachmentField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitDateField(field: DateField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitUserField(field: UserField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitCreatedByField(field: CreatedByField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitLastModifiedByField(field: LastModifiedByField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitAutoNumberField(field: AutoNumberField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitButtonField(field: ButtonField): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitLinkField(field: LinkField): Result<IFieldStorageType, DomainError> {
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

  override visitLookupField(field: LookupField): Result<IFieldStorageType, DomainError> {
    // Lookup fields need their own storage type entry, not delegation to inner field
    // They are always stored as JSON because lookups can return multiple values
    return this.setTypeFromValueType(field);
  }

  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<IFieldStorageType, DomainError> {
    return this.setTypeFromValueType(field);
  }

  visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<IFieldStorageType, DomainError> {
    // ConditionalLookup fields are stored similarly to Lookup fields
    return this.setTypeFromValueType(field);
  }

  private setTypeFromValueType(field: Field): Result<IFieldStorageType, DomainError> {
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

  if (fieldIsJson(field)) return 'JSON';

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
