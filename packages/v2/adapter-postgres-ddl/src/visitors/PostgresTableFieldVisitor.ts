import type {
  AttachmentField,
  ButtonField,
  CheckboxField,
  DateField,
  Field,
  FormulaField,
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
import type { CreateTableBuilder } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

type ICreateTableBuilder = CreateTableBuilder<string, string>;
type TableColumnDataType = Parameters<ICreateTableBuilder['addColumn']>[1];

export interface ICreateTableBuilderRef {
  builder: ICreateTableBuilder;
}

export class PostgresTableFieldVisitor implements IFieldVisitor<void> {
  constructor(private readonly builderRef: ICreateTableBuilderRef) {}

  private static isFieldArray(value: Table | ReadonlyArray<Field>): value is ReadonlyArray<Field> {
    return Array.isArray(value);
  }

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
    const columnNameResult = resolveColumnName(field);
    if (columnNameResult.isErr()) return err(columnNameResult.error);
    const dataTypeResult = resolveColumnType(field);
    if (dataTypeResult.isErr()) return err(dataTypeResult.error);
    const columnName = columnNameResult.value;
    const dataType = dataTypeResult.value;
    this.builderRef.builder = this.builderRef.builder.addColumn(
      columnName,
      dataType
    ) as unknown as ICreateTableBuilder;
    return ok(undefined);
  }
}

const resolveColumnName = (field: Field): Result<string, string> => {
  const columnNameResult = field.dbFieldName().andThen((name) => name.value());
  if (columnNameResult.isErr()) {
    return err(
      `Missing db field name for field ${field.id().toString()}: ${columnNameResult.error}`
    );
  }
  return ok(columnNameResult.value);
};

const resolveColumnType = (field: Field): Result<TableColumnDataType, string> => {
  const fieldType = field.type().toString();

  if (fieldType === 'formula') {
    const formulaField = field as FormulaField;
    return formulaField
      .cellValueType()
      .andThen((cellValueType) =>
        formulaField
          .isMultipleCellValue()
          .map((isMultiple) =>
            resolveFormulaColumnType(cellValueType.toString(), isMultiple.toBoolean())
          )
      );
  }

  if (['attachment', 'user', 'button', 'multipleSelect'].includes(fieldType)) {
    return ok('jsonb');
  }

  if (fieldType === 'number' || fieldType === 'rating') return ok('double precision');
  if (fieldType === 'date') return ok('timestamptz');
  if (fieldType === 'checkbox') return ok('boolean');
  return ok('text');
};

const resolveFormulaColumnType = (
  cellValueType: string,
  isMultiple: boolean
): TableColumnDataType => {
  if (isMultiple) return 'jsonb';

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
