import {
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
  UserField,
  getRandomString,
  match,
  P,
  isFormulaField,
  isNumericField,
  isDateField,
  isBooleanField,
  isJsonValueField,
} from '@teable/v2-core';
import type { CreateTableBuilder, Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { TableSchemaStatementBuilder } from './TableSchemaUpdateVisitor';

type TableColumnDataType = Parameters<CreateTableBuilder<string, string>['addColumn']>[1];

type TableSchemaFieldVisitorParams = {
  db: Kysely<unknown>;
  schema: string | null;
  tableName: string;
};

export class PostgresTableFieldSchemaUpdateVisitor
  implements IFieldVisitor<ReadonlyArray<TableSchemaStatementBuilder>>
{
  constructor(private readonly params: TableSchemaFieldVisitorParams) {}

  visitSingleLineTextField(
    field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnOnly(field);
  }

  visitLongTextField(
    field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnOnly(field);
  }

  visitNumberField(field: NumberField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnOnly(field);
  }

  visitRatingField(field: RatingField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnOnly(field);
  }

  visitFormulaField(
    field: FormulaField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.buildColumnStatement(field).andThen((columnStatement) =>
      this.buildFormulaReferenceStatements(field).map((referenceStatements) => [
        columnStatement,
        ...referenceStatements,
      ])
    );
  }

  visitSingleSelectField(
    field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnOnly(field);
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnOnly(field);
  }

  visitCheckboxField(
    field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnOnly(field);
  }

  visitAttachmentField(
    field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnOnly(field);
  }

  visitDateField(field: DateField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnOnly(field);
  }

  visitUserField(field: UserField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnOnly(field);
  }

  visitButtonField(field: ButtonField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnOnly(field);
  }

  private addColumnOnly(field: Field): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.buildColumnStatement(field).map((statement) => [statement]);
  }

  private buildColumnStatement(field: Field): Result<TableSchemaStatementBuilder, string> {
    const columnNameResult = resolveColumnName(field);
    if (columnNameResult.isErr()) return err(columnNameResult.error);
    const dataTypeResult = resolveColumnType(field);
    if (dataTypeResult.isErr()) return err(dataTypeResult.error);
    const columnName = columnNameResult.value;
    const dataType = dataTypeResult.value;

    const schemaBuilder = this.params.schema
      ? this.params.db.schema.withSchema(this.params.schema)
      : this.params.db.schema;
    return ok(schemaBuilder.alterTable(this.params.tableName).addColumn(columnName, dataType));
  }

  private buildFormulaReferenceStatements(
    field: FormulaField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const dependencies = field.dependencies();
    if (dependencies.length === 0) return ok([]);

    const toFieldId = field.id().toString();
    const values = dependencies.map((dependency) => {
      const referenceId = getRandomString(25);
      return sql`(${referenceId}, ${toFieldId}, ${dependency.toString()})`;
    });

    const insert = sql`
      insert into reference (id, to_field_id, from_field_id)
      values ${sql.join(values, sql`, `)}
      on conflict (to_field_id, from_field_id) do nothing
    `;
    // TODO: task_reference insertion is handled by a separate spec.
    return ok([insert]);
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
  return match(field)
    .returnType<Result<TableColumnDataType, string>>()
    .when(isFormulaField, (f) =>
      f
        .cellValueType()
        .andThen((cellValueType) =>
          f
            .isMultipleCellValue()
            .map((isMultiple) =>
              resolveFormulaColumnType(cellValueType.toString(), isMultiple.toBoolean())
            )
        )
    )
    .when(isJsonValueField, () => ok('jsonb'))
    .when(isNumericField, () => ok('double precision'))
    .when(isDateField, () => ok('timestamptz'))
    .when(isBooleanField, () => ok('boolean'))
    .otherwise(() => ok('text'));
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
