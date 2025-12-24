import {
  AbstractSpecFilterVisitor,
  TableAddFieldSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
  TableUpdateViewColumnMetaSpec,
  type Field,
  type FormulaField,
  type ITableSpecVisitor,
} from '@teable/v2-core';
import type { CompiledQuery, CreateTableBuilder, Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export type TableSchemaStatementBuilder = { compile: () => CompiledQuery };
type TableColumnDataType = Parameters<CreateTableBuilder<string, string>['addColumn']>[1];

type TableSchemaUpdateVisitorParams = {
  db: Kysely<unknown>;
  schema: string | null;
  tableName: string;
};

export class TableSchemaUpdateVisitor
  extends AbstractSpecFilterVisitor<ReadonlyArray<TableSchemaStatementBuilder>>
  implements ITableSpecVisitor<ReadonlyArray<TableSchemaStatementBuilder>>
{
  constructor(private readonly params: TableSchemaUpdateVisitorParams) {
    super();
  }

  visitTableAddField(
    spec: TableAddFieldSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const columnNameResult = resolveColumnName(spec.field());
    if (columnNameResult.isErr()) return err(columnNameResult.error);
    const dataTypeResult = resolveColumnType(spec.field());
    if (dataTypeResult.isErr()) return err(dataTypeResult.error);
    const columnName = columnNameResult.value;
    const dataType = dataTypeResult.value;

    const schemaBuilder = this.params.schema
      ? this.params.db.schema.withSchema(this.params.schema)
      : this.params.db.schema;
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [
      schemaBuilder.alterTable(this.params.tableName).addColumn(columnName, dataType),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateViewColumnMeta(
    _: TableUpdateViewColumnMetaSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableByBaseId(
    _: TableByBaseIdSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return err('TableByBaseIdSpec is not supported for table schema updates');
  }

  visitTableById(_: TableByIdSpec): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return err('TableByIdSpec is not supported for table schema updates');
  }

  visitTableByName(_: TableByNameSpec): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableByNameLike(
    _: TableByNameLikeSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return err('TableByNameLikeSpec is not supported for table schema updates');
  }

  clone(): this {
    return new TableSchemaUpdateVisitor(this.params) as this;
  }

  and(
    left: ReadonlyArray<TableSchemaStatementBuilder>,
    right: ReadonlyArray<TableSchemaStatementBuilder>
  ): ReadonlyArray<TableSchemaStatementBuilder> {
    return [...left, ...right];
  }

  or(
    left: ReadonlyArray<TableSchemaStatementBuilder>,
    right: ReadonlyArray<TableSchemaStatementBuilder>
  ): ReadonlyArray<TableSchemaStatementBuilder> {
    return [...left, ...right];
  }

  not(
    inner: ReadonlyArray<TableSchemaStatementBuilder>
  ): ReadonlyArray<TableSchemaStatementBuilder> {
    return [...inner];
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
