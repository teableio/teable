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
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  resolveColumnName,
  resolveColumnType,
  type TableColumnDataType,
} from './PostgresTableSchemaFieldColumn';

export type TableSchemaStatementBuilder = {
  compile: (executorProvider: QueryExecutorProvider) => CompiledQuery;
};

type PostgresTableSchemaFieldCreateVisitorParams = {
  addColumn: (
    columnName: string,
    dataType: TableColumnDataType
  ) => Result<ReadonlyArray<TableSchemaStatementBuilder>, string>;
  db: Kysely<unknown>;
  currentSchema: string | null;
  currentTableName: string;
  currentTableId: string;
};

type ICreateTableBuilder = CreateTableBuilder<string, string>;

export interface ICreateTableBuilderRef {
  builder: ICreateTableBuilder;
}

// Owns field-level column creation and any field-specific side statements (e.g. formula references).
export class PostgresTableSchemaFieldCreateVisitor
  implements IFieldVisitor<ReadonlyArray<TableSchemaStatementBuilder>>
{
  constructor(private readonly params: PostgresTableSchemaFieldCreateVisitorParams) {}

  static forTableCreation(params: {
    builderRef: ICreateTableBuilderRef;
    db: Kysely<unknown>;
    schema: string | null;
    tableName: string;
    tableId: string;
  }): PostgresTableSchemaFieldCreateVisitor {
    return new PostgresTableSchemaFieldCreateVisitor({
      addColumn: (columnName, dataType) => {
        params.builderRef.builder = params.builderRef.builder.addColumn(
          columnName,
          dataType
        ) as unknown as ICreateTableBuilder;
        return ok([]);
      },
      db: params.db,
      currentSchema: params.schema,
      currentTableName: params.tableName,
      currentTableId: params.tableId,
    });
  }

  static forSchemaUpdate(params: {
    db: Kysely<unknown>;
    schema: string | null;
    tableName: string;
    tableId: string;
  }): PostgresTableSchemaFieldCreateVisitor {
    const schemaBuilder = params.schema
      ? params.db.schema.withSchema(params.schema)
      : params.db.schema;
    return new PostgresTableSchemaFieldCreateVisitor({
      addColumn: (columnName, dataType) =>
        ok([
          schemaBuilder
            .alterTable(params.tableName)
            .addColumn(columnName, dataType, (col) => col.ifNotExists()),
        ]),
      db: params.db,
      currentSchema: params.schema,
      currentTableName: params.tableName,
      currentTableId: params.tableId,
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
    const visitor = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, string>(function* () {
      const fields = PostgresTableSchemaFieldCreateVisitor.isFieldArray(tableOrFields)
        ? tableOrFields
        : tableOrFields.fields();
      const statements: Array<TableSchemaStatementBuilder> = [];

      for (const field of fields) {
        const fieldStatements = yield* field.accept(visitor);
        statements.push(...fieldStatements);
      }

      return ok(statements);
    });
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

  visitLinkField(field: LinkField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const addLinkValueColumn = this.addLinkValueColumn.bind(this);
    const buildManyManyStatements = this.buildManyManyStatements.bind(this);
    const resolveFkHostTable = this.resolveFkHostTable.bind(this);
    const isCurrentTable = this.isCurrentTable.bind(this);
    const addForeignKeyColumns = this.addForeignKeyColumns.bind(this);

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, string>(function* () {
      const valueColumnStatements = yield* addLinkValueColumn(field);
      const relationship = field.relationship().toString();
      if (relationship === 'manyMany') {
        const statements = yield* buildManyManyStatements(field);
        return ok([...valueColumnStatements, ...statements]);
      }

      const fkHostTable = yield* resolveFkHostTable(field);
      if (!isCurrentTable(fkHostTable)) return ok(valueColumnStatements);

      const statements = yield* addForeignKeyColumns(field);
      return ok([...valueColumnStatements, ...statements]);
    });
  }

  private addColumnFromValueType(
    field: Field
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const params = this.params;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, string>(function* () {
      const columnName = yield* resolveColumnName(field);
      const dataType = yield* resolveColumnType(field);
      const statements = yield* params.addColumn(columnName, dataType);
      return ok(statements);
    });
  }

  private addLinkValueColumn(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const params = this.params;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, string>(function* () {
      const columnName = yield* resolveColumnName(field);
      const statements = yield* params.addColumn(columnName, 'jsonb');
      return ok(statements);
    });
  }

  private addForeignKeyColumns(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const relationship = field.relationship().toString();
    const keyNameResult =
      relationship === 'oneMany' ? field.selfKeyNameString() : field.foreignKeyNameString();

    const params = this.params;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, string>(function* () {
      const keyName = yield* keyNameResult;
      const statements = yield* params.addColumn(keyName, 'text');
      if (!field.hasOrderColumn()) return ok(statements);
      const orderColumnName = yield* field.orderColumnName();
      const orderStatements = yield* params.addColumn(orderColumnName, 'double precision');
      return ok([...statements, ...orderStatements]);
    });
  }

  private buildManyManyStatements(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const params = this.params;
    const resolveFkHostTable = this.resolveFkHostTable.bind(this);
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, string>(function* () {
      const fkHostTable = yield* resolveFkHostTable(field);
      const selfKeyName = yield* field.selfKeyNameString();
      const foreignKeyName = yield* field.foreignKeyNameString();
      const schemaBuilder = fkHostTable.schema
        ? params.db.schema.withSchema(fkHostTable.schema)
        : params.db.schema;
      let builder = schemaBuilder
        .createTable(fkHostTable.tableName)
        .ifNotExists()
        .addColumn(selfKeyName, 'text')
        .addColumn(foreignKeyName, 'text');
      if (field.hasOrderColumn()) {
        const orderColumnName = yield* field.orderColumnName();
        builder = builder.addColumn(orderColumnName, 'double precision');
      }
      return ok([builder]);
    });
  }

  private resolveFkHostTable(
    field: LinkField
  ): Result<{ schema: string | null; tableName: string }, string> {
    return field.fkHostTableName().split({ defaultSchema: this.params.currentSchema });
  }

  private isCurrentTable(target: { schema: string | null; tableName: string }): boolean {
    const currentSchema = this.params.currentSchema ?? null;
    const targetSchema = target.schema ?? null;
    return (
      targetSchema === currentSchema &&
      (target.tableName === this.params.currentTableName ||
        target.tableName === this.params.currentTableId)
    );
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
