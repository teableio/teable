import {
  getRandomString,
  type AttachmentField,
  type ButtonField,
  type CheckboxField,
  type DateField,
  type Field,
  type FormulaField,
  type IFieldVisitor,
  type LinkField,
  type LongTextField,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type SingleLineTextField,
  type SingleSelectField,
  type Table,
  type UserField,
} from '@teable/v2-core';
import type { CompiledQuery, CreateTableBuilder, Kysely, QueryExecutorProvider } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  resolveColumnName,
  resolveColumnType,
  type TableColumnDataType,
} from './PostgresTableFieldColumn';

export type TableSchemaStatementBuilder = {
  compile: (executorProvider: QueryExecutorProvider) => CompiledQuery;
};

type PostgresTableFieldCreateVisitorParams = {
  addColumn: (
    columnName: string,
    dataType: TableColumnDataType
  ) => Result<ReadonlyArray<TableSchemaStatementBuilder>, string>;
};

type ICreateTableBuilder = CreateTableBuilder<string, string>;

export interface ICreateTableBuilderRef {
  builder: ICreateTableBuilder;
}

// Owns field-level column creation and any field-specific side statements (e.g. formula references).
export class PostgresTableFieldCreateVisitor
  implements IFieldVisitor<ReadonlyArray<TableSchemaStatementBuilder>>
{
  constructor(private readonly params: PostgresTableFieldCreateVisitorParams) {}

  static forTableCreation(builderRef: ICreateTableBuilderRef): PostgresTableFieldCreateVisitor {
    return new PostgresTableFieldCreateVisitor({
      addColumn: (columnName, dataType) => {
        builderRef.builder = builderRef.builder.addColumn(
          columnName,
          dataType
        ) as unknown as ICreateTableBuilder;
        return ok([]);
      },
    });
  }

  static forSchemaUpdate(params: {
    db: Kysely<unknown>;
    schema: string | null;
    tableName: string;
  }): PostgresTableFieldCreateVisitor {
    const schemaBuilder = params.schema
      ? params.db.schema.withSchema(params.schema)
      : params.db.schema;
    return new PostgresTableFieldCreateVisitor({
      addColumn: (columnName, dataType) =>
        ok([schemaBuilder.alterTable(params.tableName).addColumn(columnName, dataType)]),
    });
  }

  private static isFieldArray(value: Table | ReadonlyArray<Field>): value is ReadonlyArray<Field> {
    return Array.isArray(value);
  }

  apply(table: Table): Result<ReadonlyArray<TableSchemaStatementBuilder>, string>;
  apply(fields: ReadonlyArray<Field>): Result<ReadonlyArray<TableSchemaStatementBuilder>, string>;
  apply(
    tableOrFields: Table | ReadonlyArray<Field>
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const fields = PostgresTableFieldCreateVisitor.isFieldArray(tableOrFields)
      ? tableOrFields
      : tableOrFields.fields();
    const statements: Array<TableSchemaStatementBuilder> = [];

    for (const field of fields) {
      const result = field.accept(this);
      if (result.isErr()) return err(result.error);
      statements.push(...result.value);
    }

    return ok(statements);
  }

  visitSingleLineTextField(
    field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnFromValueType(field);
  }

  visitLongTextField(
    field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnFromValueType(field);
  }

  visitNumberField(field: NumberField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnFromValueType(field);
  }

  visitRatingField(field: RatingField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnFromValueType(field);
  }

  visitFormulaField(
    field: FormulaField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnFromValueType(field).andThen((columnStatements) =>
      this.buildFormulaReferenceStatements(field).map((referenceStatements) => [
        ...columnStatements,
        ...referenceStatements,
      ])
    );
  }

  visitSingleSelectField(
    field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnFromValueType(field);
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnFromValueType(field);
  }

  visitCheckboxField(
    field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnFromValueType(field);
  }

  visitAttachmentField(
    field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnFromValueType(field);
  }

  visitDateField(field: DateField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnFromValueType(field);
  }

  visitUserField(field: UserField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnFromValueType(field);
  }

  visitButtonField(field: ButtonField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.addColumnFromValueType(field);
  }

  visitLinkField(_: LinkField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return err('Not implemented');
  }

  private addColumnFromValueType(
    field: Field
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const columnNameResult = resolveColumnName(field);
    if (columnNameResult.isErr()) return err(columnNameResult.error);
    const dataTypeResult = resolveColumnType(field);
    if (dataTypeResult.isErr()) return err(dataTypeResult.error);
    const columnName = columnNameResult.value;
    const dataType = dataTypeResult.value;

    return this.params.addColumn(columnName, dataType);
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
