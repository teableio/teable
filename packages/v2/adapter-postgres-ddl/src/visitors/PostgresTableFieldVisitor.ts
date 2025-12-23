import { FieldValueTypeVisitor } from '@teable/v2-core';
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
  FormulaField,
} from '@teable/v2-core';
import type { CreateTableBuilder } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

type ICreateTableBuilder = CreateTableBuilder<string, string>;
type ITableColumnDataType = Parameters<ICreateTableBuilder['addColumn']>[1];

export interface ICreateTableBuilderRef {
  builder: ICreateTableBuilder;
}

export class PostgresTableFieldVisitor implements IFieldVisitor<void> {
  constructor(private readonly builderRef: ICreateTableBuilderRef) {}

  private static isFieldArray(value: Table | ReadonlyArray<Field>): value is ReadonlyArray<Field> {
    return Array.isArray(value);
  }

  private readonly valueTypeVisitor = new FieldValueTypeVisitor();

  apply(table: Table): Result<void, string>;
  apply(fields: ReadonlyArray<Field>): Result<void, string>;
  apply(tableOrFields: Table | ReadonlyArray<Field>): Result<void, string> {
    const fields = PostgresTableFieldVisitor.isFieldArray(tableOrFields)
      ? tableOrFields
      : tableOrFields.fields();

    for (const field of fields) {
      const result = field.accept(this);
      if (result.isErr()) return err(result.error);
    }

    return ok(undefined);
  }

  visitSingleLineTextField(field: SingleLineTextField): Result<void, string> {
    return this.addColumnFromValueType(field);
  }

  visitLongTextField(field: LongTextField): Result<void, string> {
    return this.addColumnFromValueType(field);
  }

  visitNumberField(field: NumberField): Result<void, string> {
    return this.addColumnFromValueType(field);
  }

  visitRatingField(field: RatingField): Result<void, string> {
    return this.addColumnFromValueType(field);
  }

  visitFormulaField(field: FormulaField): Result<void, string> {
    return this.addColumnFromValueType(field);
  }

  visitSingleSelectField(field: SingleSelectField): Result<void, string> {
    return this.addColumnFromValueType(field);
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<void, string> {
    return this.addColumnFromValueType(field);
  }

  visitCheckboxField(field: CheckboxField): Result<void, string> {
    return this.addColumnFromValueType(field);
  }

  visitAttachmentField(field: AttachmentField): Result<void, string> {
    return this.addColumnFromValueType(field);
  }

  visitDateField(field: DateField): Result<void, string> {
    return this.addColumnFromValueType(field);
  }

  visitUserField(field: UserField): Result<void, string> {
    return this.addColumnFromValueType(field);
  }

  visitButtonField(field: ButtonField): Result<void, string> {
    return this.addColumnFromValueType(field);
  }

  private addColumnFromValueType(field: Field): Result<void, string> {
    const valueTypeResult = field.accept(this.valueTypeVisitor);
    if (valueTypeResult.isErr()) return err(valueTypeResult.error);
    const { cellValueType, isMultipleCellValue } = valueTypeResult.value;
    const dataType = resolveColumnType(
      field.type().toString(),
      cellValueType.toString(),
      isMultipleCellValue.toBoolean()
    );
    return this.addColumn(field, dataType);
  }

  private addColumn(field: Field, dataType: ITableColumnDataType): Result<void, string> {
    const columnNameResult = field.dbFieldName().andThen((name) => name.value());
    if (columnNameResult.isErr()) {
      return err(
        `Missing db field name for field ${field.id().toString()}: ${columnNameResult.error}`
      );
    }
    const columnName = columnNameResult.value;
    this.builderRef.builder = this.builderRef.builder.addColumn(
      columnName,
      dataType
    ) as unknown as ICreateTableBuilder;
    return ok(undefined);
  }
}

const resolveColumnType = (
  fieldType: string,
  cellValueType: string,
  isMultipleCellValue: boolean
): ITableColumnDataType => {
  if (isMultipleCellValue) return 'jsonb';
  if (['attachment', 'user', 'button'].includes(fieldType)) return 'jsonb';

  switch (cellValueType) {
    case 'number':
      return 'double precision';
    case 'dateTime':
      return 'timestamptz';
    case 'boolean':
      return 'boolean';
    case 'string':
    default:
      return 'text';
  }
};
