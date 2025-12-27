import {
  AbstractSpecFilterVisitor,
  TableAddFieldSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByIdsSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
  TableUpdateViewColumnMetaSpec,
  type ITableSpecVisitor,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import {
  PostgresTableSchemaFieldCreateVisitor,
  TableSchemaStatementBuilder,
} from './PostgresTableSchemaFieldCreateVisitor';

type TableSchemaUpdateVisitorParams = {
  db: Kysely<V1TeableDatabase>;
  schema: string | null;
  tableName: string;
  tableId: string;
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
    const fieldVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate(this.params);
    const addCond = this.addCond.bind(this);
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, string>(function* () {
      const statements = yield* spec.field().accept(fieldVisitor);
      yield* addCond(statements);
      return ok(statements);
    });
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

  visitTableByIds(_: TableByIdsSpec): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return err('TableByIdsSpec is not supported for table schema updates');
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
